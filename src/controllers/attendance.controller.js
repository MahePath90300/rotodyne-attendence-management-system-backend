const { format, addDays } = require("date-fns");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const AttendanceSummary = require("../models/AttendanceSummary"); // NEW
const { resolveAttendanceCycle } = require("../config/attendanceCycle");
const ServiceMovement = require("../models/ServiceMovement");
const { resolveWagePolicy } = require("../config/wagePolicy");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildMonthWindow(year, month, siteId) {
  if (!year || !month) {
    throw new Error("Invalid year or month");
  }
  const cycle = resolveAttendanceCycle(siteId);
  const { start, end } = cycle.buildRange(year, month);

  if (!start || isNaN(start) || !end || isNaN(end)) {
    throw new Error("Invalid date range generated");
  }
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push(format(d, "yyyy-MM-dd"));
  }

  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
    days,
    cycleType: cycle.type,
  };
}

exports.getSiteAttendance = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({
        message: "Invalid year or month parameter",
      });
    }
    const { start, end, days } = buildMonthWindow(year, month, siteId);

    const employees = await Employee.find({ site: siteId })
      .sort({ empNo: 1 })
      .lean();

    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    const movements = await ServiceMovement.find({
      siteId,
      date: { $gte: start, $lte: end },
    });

    const movementMap = {};

    movements.forEach((m) => {
      if (!movementMap[m.empNo]) movementMap[m.empNo] = {};

      movementMap[m.empNo][m.date] = {
        from: m.from,
        to: m.to,
        startTime: m.startTime,
        endTime: m.endTime,
      };
    });

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

    const policy = await resolveWagePolicy(siteId);
    const holidays = {};

    for (const h of holidayDocs) {
      holidays[h.date] = {
        type: h.type,
        description: h.description,
      };
    }
    const siteType = (employees[0] && employees[0].siteType) || "Supply";

    const summaries = await AttendanceSummary.find({
      siteId,
      year,
      month,
    }).lean();

    const summaryMap = {};
    for (const s of summaries) {
      summaryMap[s.empNo] = s;
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    res.json({
      siteTitle: siteId,
      siteType,
      employees,
      attendanceMap,
      otMap,
      summaryMap,
      movementMap,
      holidays,
      group: policy.group,
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
    const { serviceMovements } = req.body;
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

    // AUTO ATTENDANCE FROM MOVEMENT
    for (const empNo of Object.keys(serviceMovements || {})) {
      const dates = serviceMovements[empNo];

      for (const date of Object.keys(dates)) {
        const m = dates[date];

        const status = m.to === "HOME" || m.from === "HOME" ? "A" : "P";

        const key = `${empNo}|${date}`;

        if (!upsertMap.has(key)) upsertMap.set(key, {});
        upsertMap.get(key).status = status;
      }
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
    }
    // ============================
    // SAVE SERVICE MOVEMENTS
    // ============================

    if (serviceMovements) {
      const ops = [];

      for (const empNo of Object.keys(serviceMovements)) {
        const dates = serviceMovements[empNo];

        for (const date of Object.keys(dates)) {
          const m = dates[date];

          if (!m?.from && !m?.to) continue;

          const duration =
            m.startTime && m.endTime
              ? (new Date(`1970-01-01T${m.endTime}`) -
                  new Date(`1970-01-01T${m.startTime}`)) /
                60000
              : 0;

          ops.push({
            updateOne: {
              filter: { empNo, date },
              update: {
                $set: {
                  empNo,
                  siteId,
                  date,
                  from: m.from,
                  to: m.to,
                  startTime: m.startTime,
                  endTime: m.endTime,
                  durationMinutes: duration,
                  updatedAt: new Date(),
                },
              },
              upsert: true,
            },
          });
        }
      }

      if (ops.length) {
        await ServiceMovement.bulkWrite(ops);
      }
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
        { $set: { lastSubmissionDate: nowIso } },
      );
      req.user.lastSubmissionDate = nowIso;
    }

    return res.json({ message: "Attendance / OT updated" });
  } catch (err) {
    next(err);
  }
};
