// scripts/seedDebug.cjs
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("../src/models/User");

function maskUri(uri) {
  if (!uri) return "(not set)";
  try {
    return uri.replace(/(\/\/.*:).*@/, "$1*****@");
  } catch (e) {
    return "(masked)";
  }
}

(async function run() {
  console.log("--- seedDebug starting ---");
  console.log("NODE env:", process.env.NODE_ENV || "not set");
  console.log("MONGO_URI (masked):", maskUri(process.env.MONGO_URI));
  if (!process.env.MONGO_URI) {
    console.error(
      "ERROR: MONGO_URI not set in .env. Create .env from .env.example and set it."
    );
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DBNAME || undefined,
    });
    console.log(
      "Mongoose connected. connection.name:",
      mongoose.connection.name
    );
    console.log("Mongoose readyState:", mongoose.connection.readyState); // 1 = connected

    const allUsers = await User.find({}).lean();
    console.log("Existing users count:", (allUsers && allUsers.length) || 0);
    console.log("Users sample:", allUsers);

    // Try to create admin if not present
    const adminEmail = "praveen@rotodyne.com";
    const adminExists = await User.findOne({ email: adminEmail });
    if (adminExists) {
      console.log("Admin already exists:", adminEmail);
    } else {
      console.log("Creating admin user...");
      const pwd = await bcrypt.hash("Password123!", 10);
      const admin = new User({
        email: adminEmail,
        password: pwd,
        employeeId: "VR001",
        company: "RES",
        site: "GADARWARA",
        role: "VIEWER",
        lastLoginDate: null,
      });
      const saved = await admin.save();
      console.log("Admin saved _id:", saved._id.toString());
    }

    // Create SITE_ENGINEER if not present
    const engEmail = "vinay@rotodyne.com";
    const engExists = await User.findOne({ email: engEmail });
    if (engExists) {
      console.log("Engineer already exists:", engEmail);
    } else {
      console.log("Creating engineer user...");
      const pwd2 = await bcrypt.hash("Password123!", 10);
      const eng = new User({
        email: engEmail,
        password: pwd2,
        employeeId: "ENG001",
        company: "RES",
        site: "GADARWARA",
        role: "SITE_ENGINEER",
        lastLoginDate: null,
      });
      const saved2 = await eng.save();
      console.log("Engineer saved _id:", saved2._id.toString());
    }

    const after = await User.find({}).lean();
    console.log("After seed users count:", (after && after.length) || 0);
    console.log("After users sample:", after);

    await mongoose.disconnect();
    console.log("Disconnected. seedDebug finished.");
    process.exit(0);
  } catch (err) {
    console.error("SEED DEBUG ERROR:", err && err.stack ? err.stack : err);
    try {
      await mongoose.disconnect();
    } catch (e) {}
    process.exit(1);
  }
})();
