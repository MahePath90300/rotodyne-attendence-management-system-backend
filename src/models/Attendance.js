const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, index: true }, // e.g. "DADRI", "GARADWARA"
    empNo: { type: String, required: true, index: true }, // employee id
    date: { type: String, required: true, index: true }, // ISO date "YYYY-MM-DD"
    status: { type: String, required: true }, // P/A/OT/HW/PP etc.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
  }
);

AttendanceSchema.index({ siteId: 1, date: 1, empNo: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
