// src/models/AttendanceSummary.js
const mongoose = require("mongoose");

const AttendanceSummarySchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true },
    empNo: { type: Number, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1..12 (month for 26→25 window)

    otHours: { type: Number, default: 0 },
    totalPresentDays: { type: Number, default: 0 },
    totalAbsents: { type: Number, default: 0 },
    totalLeaves: { type: Number, default: 0 },
    totalWeekOffs: { type: Number, default: 0 },
    totalCasualLeaves: { type: Number, default: 0 },
    totalDaysWorked: { type: Number, default: 0 },
    totalCalendarDays: { type: Number, default: 0 },
    totalHolidays : {type:Number, default:0}
  },
  { timestamps: true }
);

AttendanceSummarySchema.index(
  { siteId: 1, empNo: 1, year: 1, month: 1 },
  { unique: true }
);

module.exports = mongoose.model("AttendanceSummary", AttendanceSummarySchema);
