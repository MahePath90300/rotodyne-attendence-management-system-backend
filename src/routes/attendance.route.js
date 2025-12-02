const express = require('express');
const router = express.Router();
const attendance = require('../controllers/attendance.controller');
const { protect } = require('../middleware/auth'); // your auth middleware

router.get('/site/:siteId', protect, attendance.getSiteAttendance);
router.put('/site/:siteId/bulk', protect, attendance.bulkUpdate);

module.exports = router;
