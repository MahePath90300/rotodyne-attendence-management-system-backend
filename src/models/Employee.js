const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
  empNo: { type: String, required: true },
  name: { type: String, required: true },
  designation: String,
  category: String, // HSW / SSW / USW etc.
  salaryType: {
    type: String,
    enum: ["MWB", "FIXED"], // Minimum Wage Based / Fixed
    required: true,
    default: "MWB",
  },
  salary: {
    type: Number, // only used if salaryType === "FIXED"
    default: 0,
  },
  site: { type: String, required: true }, // "DADRI", "GADARWARA"
  siteType: {
    // "Supply" or "BOQ"
    type: String,
    enum: ["supply", "BOQ"],
    required: true,
  },
});

employeeSchema.index({ site: 1, empNo: 1 }, { unique: true });

module.exports = mongoose.model("Employee", employeeSchema);
