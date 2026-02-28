const mongoose = require("mongoose");

const movementSchema = new mongoose.Schema(
  {
    empNo: { type: String, required: true },
    siteId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD

    from: String,
    to: String,

    startTime: String,
    endTime: String,

    durationMinutes: Number,
  },
  { timestamps: true },
);

movementSchema.index({ empNo: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("ServiceMovement", movementSchema);
