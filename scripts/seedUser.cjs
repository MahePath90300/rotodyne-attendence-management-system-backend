// scripts/listUsers.cjs
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const User = require('../src/models/User');

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, {});
  const users = await User.find({}, 'email employeeId role company site lastLoginDate').lean();
  console.log(JSON.stringify(users, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})();
