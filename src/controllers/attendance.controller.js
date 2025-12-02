// src/controllers/attendance.controller.js (CommonJS)
const Attendance = require('src/models/Attendance.js');
const User = require('../models/User'); // your user model
const mongoose = require('mongoose');
// date-fns for date handling (install: npm i date-fns)
const { formatISO, parseISO } = require('date-fns');

function todayISO() {
  const d = new Date();
  // yyyy-mm-dd
  return d.toISOString().slice(0,10);
}

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
      const allToday = updates.every(u => u.date === nowIso);
      if (!allToday) {
        return res.status(403).json({ message: 'Site engineers may only update today’s attendance' });
      }
      // one-per-day rule
      const lastSub = req.user.lastSubmissionDate || null; // stored in user doc as YYYY-MM-DD
      if (lastSub === nowIso) {
        return res.status(429).json({ message: 'You have already submitted attendance today' });
      }
    }

    // Now perform upsert for each update (atomic option: bulkWrite)
    const ops = updates.map(u => {
      return {
        updateOne: {
          filter: { siteId, empNo: u.empNo, date: u.date },
          update: {
            $set: {
              status: u.status,
              updatedBy: req.user._id,
              updatedByName: req.user.email || req.user.name || '',
              updatedAt: new Date()
            }
          },
          upsert: true
        }
      };
    });

    if (ops.length > 0) {
      await Attendance.bulkWrite(ops, { ordered: false });
    }

    // If site engineer, update user's lastSubmissionDate field
    if (userRole === 'SITE_ENGINEER') {
      await User.updateOne({ _id: req.user._id }, { $set: { lastSubmissionDate: nowIso } });
      // also update req.user so subsequent logic sees it
      req.user.lastSubmissionDate = nowIso;
    }

    return res.json({ message: 'Attendance updated' });
  } catch (err) {
    next(err);
  }
};
