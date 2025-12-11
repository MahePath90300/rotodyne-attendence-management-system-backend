const { format, addDays } = require("date-fns");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const AttendanceSummary = require("../models/AttendanceSummary"); // NEW

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildMonthWindow(year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const start = new Date(prevYear, prevMonth - 1, 26);
  const end = new Date(year, month - 1, 25);
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push(format(d, "yyyy-MM-dd")); // local date, matches DB
  }
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
    days,
  };
}

exports.getSiteAttendance = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    const { start, end, days } = buildMonthWindow(year, month);

    const employees = await Employee.find({ site: siteId })
      .sort({ empNo: 1 })
      .lean();

    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    const attendanceMap = {};
    const otMap = {};

    for (const doc of attDocs) {
      if (!attendanceMap[doc.empNo]) attendanceMap[doc.empNo] = {};
      if (!otMap[doc.empNo]) otMap[doc.empNo] = {};

      if (doc.status) {
        attendanceMap[doc.empNo][doc.date] = doc.status;
      }
      if (doc.otHours != null) {
        otMap[doc.empNo][doc.date] = doc.otHours;
      }
    }

    const holidayDocs = await Holiday.find({
      site: siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    const holidays = holidayDocs.map((h) => h.date); // ["2025-12-25", ...]
    const siteType = (employees[0] && employees[0].siteType) || "Supply";

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    res.json({
      siteTitle: `NTPC ${siteId}`,
      siteType,
      employees,
      attendanceMap,
      otMap,
      holidays,
      start,
      end,
      days,
    });
  } catch (err) {
    next(err);
  }
};

exports.bulkUpdate = async function (req, res, next) {
  try {
    const { siteId } = req.params;

    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    const otUpdates = Array.isArray(req.body.otUpdates)
      ? req.body.otUpdates
      : [];
    const summaries = Array.isArray(req.body.summaries)
      ? req.body.summaries
      : [];

    if (!updates.length && !otUpdates.length && !summaries.length) {
      return res.status(400).json({
        message: "Nothing to update (updates / otUpdates / summaries empty)",
      });
    }

    // --- Basic validation on status updates only (OT rows may not have status) ---
    for (const u of updates) {
      if (!u.empNo || !u.date || !u.status) {
        return res.status(400).json({
          message: "Each status update requires empNo, date and status",
        });
      }
    }

    const userRole = (req.user.role || "").toUpperCase();
    const userSite = req.user.site;

    if (userRole === "VIEWER") {
      return res
        .status(403)
        .json({ message: "Viewer cannot update attendance" });
    }

    const nowIso = todayISO();

    if (userRole === "SITE_ENGINEER") {
      if (String(userSite).toUpperCase() !== String(siteId).toUpperCase()) {
        return res
          .status(403)
          .json({ message: "You are not assigned to this site" });
      }

      // SITE_ENGINEER may only touch today’s records
      const allDates = [
        ...updates.map((u) => u.date),
        ...otUpdates.map((o) => o.date),
      ];
      const allToday = allDates.every((d) => d === nowIso);
      if (!allToday) {
        return res.status(403).json({
          message: "Site engineers may only update today’s attendance",
        });
      }

      const lastSub = req.user.lastSubmissionDate || null;
      if (lastSub === nowIso) {
        return res.status(429).json({
          message: "You have already submitted attendance today",
        });
      }
    }

    // --- Merge status + OT per (empNo, date) ---
    const upsertMap = new Map();

    for (const u of updates) {
      const key = `${u.empNo}|${u.date}`;
      if (!upsertMap.has(key)) upsertMap.set(key, {});
      upsertMap.get(key).status = u.status;
    }

    for (const o of otUpdates) {
      if (!o.empNo || !o.date) continue;
      const key = `${o.empNo}|${o.date}`;
      if (!upsertMap.has(key)) upsertMap.set(key, {});
      upsertMap.get(key).otHours = Number(o.hours) || 0;
    }

    const bulkOps = [];
    for (const [key, fields] of upsertMap.entries()) {
      const [empNo, date] = key.split("|");

      const setObj = {
        // only include fields that should actually be set
        siteId,
        empNo,
        date,
        updatedBy: req.user._id,
        updatedByName: req.user.email || req.user.name || "",
        updatedAt: new Date(),
      };

      // status: only set if provided (keep empty string if desired — or omit to avoid blank)
      if (typeof fields.status !== "undefined") {
        setObj.status = fields.status;
      }

      // otHours: include only when provided
      if (typeof fields.otHours !== "undefined") {
        setObj.otHours = fields.otHours;
      }
      if (typeof fields.otHours !== "undefined")
        setObj.otHours = fields.otHours;

      bulkOps.push({
        updateOne: {
          filter: { siteId, empNo, date },
          update: {
            $set: setObj,
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length) {
      const bulkData = await Attendance.bulkWrite(bulkOps, { ordered: false });
      console.log(bulkData);
    }

    // Persist summaries (upsert-like)
    if (summaries && summaries.length) {
      const summaryBulk = summaries.map((s) => ({
        updateOne: {
          filter: {
            siteId: s.siteId,
            empNo: s.empNo,
            year: s.year,
            month: s.month,
          },
          update: {
            $set: {
              ...s,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      }));
      if (summaryBulk.length) {
        await AttendanceSummary.bulkWrite(summaryBulk, { ordered: false });
      }
    }

    if (userRole === "SITE_ENGINEER") {
      await User.updateOne(
        { _id: req.user._id },
        { $set: { lastSubmissionDate: nowIso } }
      );
      req.user.lastSubmissionDate = nowIso;
    }

    return res.json({ message: "Attendance / OT updated" });
  } catch (err) {
    next(err);
  }
};