// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { generateToken } = require('../utils/jwt');

function todayDateStringUTC() {
  // returns YYYY-MM-DD in UTC
  return new Date().toISOString().slice(0, 10);
}

exports.login = async function login(req, res, next) {
  try {
    const { email, password, employeeId, company, site, role } = req.body;

    if (!email || !password || !employeeId || !role) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(401).json({ message: 'Invalid password' });

    // Enforce one-login-per-day for SITE_ENGINEER
    if (String(user.role).toUpperCase() === 'SITE_ENGINEER') {
      const today = todayDateStringUTC();
      if (user.lastLoginDate === today) {
        // Already logged in today — reject with 403
        return res.status(403).json({
          message: 'Site engineers are allowed to login once per day. You have already logged in today.'
        });
      }
      // Otherwise, update lastLoginDate below (after token generation)
    }

    const token = generateToken({
      id: user._id,
      email: user.email,
      role: user.role,
      company: user.company,
      site: user.site
    });

    // Set httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    // If SITE_ENGINEER, update lastLoginDate to today (persist)
    if (String(user.role).toUpperCase() === 'SITE_ENGINEER') {
      try {
        user.lastLoginDate = todayDateStringUTC();
        // Save asynchronously but wait to ensure it's persisted
        await user.save();
      } catch (saveErr) {
        // Non-fatal (we already issued cookie). Log it and continue.
        console.error('Failed to update lastLoginDate for user', user._id, saveErr);
      }
    }

    res.status(200).json({
      message: 'Login successful',
      user: {
        email: user.email,
        company: user.company,
        site: user.site,
        role: user.role,
        employeeId: user.employeeId
      }
    });
  } catch (error) {
    next(error);
  }
};
