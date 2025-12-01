const mongoose = require("mongoose");
const { MONGO_URI } = require("./env");

async function connectDB() {
  if (!MONGO_URI) {
    console.warn("MONGO_URI not set - skipping DB connect (dev mode?)");
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: process.env.MONGO_DBNAME || undefined,
    });
    console.log("✓ MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}
module.exports = connectDB;
