// src/models/Attendance.js
const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, index: true }, // "DADRI", "GADARWARA"
    empNo: { type: String, required: true, index: true }, // employee id
    date: { type: String, required: true, index: true }, // "YYYY-MM-DD"

    // Attendance code: "PP", "P", "AA", "A", "LL", "CC", "WW", "HW", etc.
    // Make it OPTIONAL so OT-only updates don't fail validation.
    status: { type: String, default: "" },

    // NEW: OT hours recorded for that day
    otHours: { type: Number, default: 0 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
  }
);

// unique per site + date + employee
AttendanceSchema.index({ siteId: 1, date: 1, empNo: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);
