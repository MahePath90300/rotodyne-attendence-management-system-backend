
const Attendance = require('src/models/Attendance.js');

exports.getSiteAttendance = async function (req, res, next) {
  // query: /api/v1/attendance/site/:siteId?start=2025-11-26&end=2025-12-25
  try {
    const { siteId } = req.params;
    const { start, end } = req.query;
    const docs = await Attendance.find({
      siteId,
      date: { $gte: start, $lte: end }
    }).lean();
    res.json({ attendance: docs });
  } catch (err) {
    next(err);
  }
};

exports.bulkUpdate = async function (req, res, next) {
  res.status(501).json({ message: 'Not implemented' });
};
