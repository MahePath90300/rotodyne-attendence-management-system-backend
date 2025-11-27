// scripts/resetLastLogin.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const User = require('../src/models/User');

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const res = await User.updateMany({}, { $unset: { lastLoginDate: "" }});
  console.log('Reset lastLoginDate for users:', res.modifiedCount || res.nModified || res);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
