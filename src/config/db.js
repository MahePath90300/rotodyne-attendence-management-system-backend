const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error("❌ MONGO_URI not defined");
    return;
  }

  try {
    await mongoose.connect(uri, {
      dbName: process.env.MONGO_DBNAME,
      serverSelectionTimeoutMS: 10000,
    });

    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
  }
}

module.exports = connectDB;
