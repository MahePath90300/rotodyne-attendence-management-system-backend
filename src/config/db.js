const mongoose = require("mongoose");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const uri = process.env.MONGO_URI;

    if (!uri) {
      throw new Error("❌ MONGO_URI not defined");
    }

    cached.promise = mongoose.connect(uri, {
      dbName: process.env.MONGO_DBNAME,
      serverSelectionTimeoutMS: 5000,
    });
  }

  cached.conn = await cached.promise;
  console.log("✅ MongoDB connected");
  console.log("🧪 MONGO_URI exists:", !!process.env.MONGO_URI);
  console.log("🧪 DB NAME:", process.env.MONGO_DBNAME);

  return cached.conn;
}

module.exports = connectDB;
