const path = require('path');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const mongoose = require('mongoose');
const { format, addDays, parseISO } = require('date-fns');

/**
 * buildMonthWindow(year, month)
 * returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', days: [...] }
 * month is 1..12
 */
function buildMonthWindow(year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const start = new Date(prevYear, prevMonth - 1, 26);
  const end = new Date(year, month - 1, 25);
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push(format(d, 'yyyy-MM-dd'));
  }
  return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd'), days };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * GET /api/v1/attendance/site/:siteId?year=YYYY&month=MM
 * returns:
 * { siteTitle, siteType, employees: [...], attendanceMap: { empNo: { date: status } }, holidays: [...] }
 */
exports.getSiteAttendance = async function (req, res, next) {
  try {
    const { siteId } = req.params;
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);

    if (!siteId) return res.status(400).json({ message: 'siteId required' });

    // If year/month provided, compute start/end as 26(prev) -> 25(current)
    let startDate, endDate;
    if (Number.isInteger(year) && Number.isInteger(month)) {
      const win = buildMonthWindow(year, month);
      startDate = win.start;
      endDate = win.end;
    } else {
      // fallback: return last 30 days
      const end = new Date();
      const start = addDays(end, -29);
      startDate = format(start, 'yyyy-MM-dd');
      endDate = format(end, 'yyyy-MM-dd');
    }

    // Query attendance rows for the site in that date range
    const docs = await Attendance.find({
      siteId: siteId,
      date: { $gte: startDate, $lte: endDate },
    }).lean();

    // Build attendanceMap: { empNo: { date: status } }
    const attendanceMap = {};
    const holidaysSet = new Set();

    for (const d of docs) {
      if (!attendanceMap[d.empNo]) attendanceMap[d.empNo] = {};
      attendanceMap[d.empNo][d.date] = d.status;
      // optionally: if you store holiday status in record, collect it
      // e.g., if (d.status === 'HOL') holidaysSet.add(d.date);
    }

    // Holidays list: if you store holidays in a separate collection, fetch them.
    // For now, we'll check attendance records for any 'HW' or 'H' or you'll fetch from Holiday collection.
    // Simple placeholder: pick dates where any record has status 'H'/'HW' etc.
    for (const empNo of Object.keys(attendanceMap)) {
      const map = attendanceMap[empNo];
      for (const dateKey of Object.keys(map)) {
        const st = map[dateKey];
        if (st === 'H' || st === 'HW' || st === 'HOL') holidaysSet.add(dateKey);
      }
    }

    // Employees list: ideally read from separate collection (Employee) else infer from attendance docs.
    let employees = [];
    if (typeof Employee === 'function') {
      // if you have Employee model, fetch site employees for this site
      try {
        employees = await Employee.find({ site: siteId }).lean();
      } catch (e) {
        // ignore, fallback to infer
        employees = [];
      }
    }

    if (!employees || employees.length === 0) {
      // infer employees from attendance docs
      const empNos = new Set();
      for (const d of docs) empNos.add(d.empNo);
      // map to basic structure: { empNo, name?, designation?, category? }
      employees = Array.from(empNos).map((eno) => ({
        empNo: eno,
        name: eno,
        designation: '',
        category: '',
        site: siteId,
      }));
    }

    // Return site meta + attendance
    return res.json({
      siteTitle: `NTPC ${siteId}`,
      siteType: 'Supply', // if you have site meta, return correct value
      employees,
      attendanceMap,
      holidays: Array.from(holidaysSet).sort(),
      start: startDate,
      end: endDate,
    });
  } catch (err) {
    next(err);
  }
};

exports.bulkUpdate = async function (req, res, next) {
  try {
    const { siteId } = req.params;
    const updates = req.body.updates; // expected: [{ empNo, date: 'YYYY-MM-DD', status }, ...]
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ message: 'Updates array required' });
    }

    // Basic validation:
    for (const u of updates) {
      if (!u.empNo || !u.date || !u.status) {
        return res.status(400).json({ message: 'Each update requires empNo, date and status' });
      }
    }

    const userRole = (req.user.role || '').toUpperCase();
    const userSite = req.user.site; // site assigned to site engineer

    // ROLE checks:
    if (userRole === 'VIEWER') {
      return res.status(403).json({ message: 'Viewer cannot update attendance' });
    }

    const nowIso = todayISO();

    if (userRole === 'SITE_ENGINEER') {
      // ensure site match
      if (String(userSite).toUpperCase() !== String(siteId).toUpperCase()) {
        return res.status(403).json({ message: 'You are not assigned to this site' });
      }
      // ensure all updates are for today only
      const allToday = updates.every((u) => u.date === nowIso);
      if (!allToday) {
        return res.status(403).json({ message: 'Site engineers may only update today’s attendance' });
      }
      // one-per-day rule
      const lastSub = req.user.lastSubmissionDate || null; // stored in user doc as YYYY-MM-DD
      if (lastSub === nowIso) {
        return res.status(429).json({ message: 'You have already submitted attendance today' });
      }
    }

    const ops = updates.map((u) => ({
      updateOne: {
        filter: { siteId, empNo: u.empNo, date: u.date },
        update: {
          $set: {
            status: u.status,
            updatedBy: req.user._id,
            updatedByName: req.user.email || req.user.name || '',
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    if (ops.length > 0) {
      await Attendance.bulkWrite(ops, { ordered: false });
    }

    // If site engineer, update user's lastSubmissionDate field
    if (userRole === 'SITE_ENGINEER') {
      await User.updateOne({ _id: req.user._id }, { $set: { lastSubmissionDate: nowIso } });
      req.user.lastSubmissionDate = nowIso;
    }

    return res.json({ message: 'Attendance updated' });
  } catch (err) {
    next(err);
  }
};
