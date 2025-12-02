const express = require('express');
const router = express.Router();
const attendance = require('../controllers/attendance.controller');
const protect  = require('../middlewares/authMiddleware'); 

router.get('/site/:siteId', protect, attendance.getSiteAttendance);
router.put('/site/:siteId/bulk', protect, attendance.bulkUpdate);

module.exports = router;
