const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema({
  site: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  type: {
    type: String,
    enum: ["SUNDAY", "HOLIDAY", "OFF", "NATIONAL HOLIDAY", "FESTIVAL HOLIDAY"],
    default: "HOLIDAY",
  },
  description: String,
});

holidaySchema.index({ site: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Holiday", holidaySchema);
