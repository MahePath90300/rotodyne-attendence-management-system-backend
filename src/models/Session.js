// src/models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (based on Asia/Kolkata)
    company: { type: String },
    site: { type: String },
    ip: { type: String },
    userAgent: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Session', sessionSchema);
