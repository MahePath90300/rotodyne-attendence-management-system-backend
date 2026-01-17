const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Session = require("../models/Session");
const generateToken = require("../utils/jwt");
const { validationResult } = require("express-validator");

function todayDateStringUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  };
}

exports.login = async (req, res) => {
  try {
    console.log("🔐 Login request body:", req.body);

    const { email, password, employeeId, company, site, role } = req.body;

    console.log("🔍 Searching user with email:", email);

    const user = await User.findOne({ email });

    console.log("👤 User found:", user);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // password check (example)
    const isMatch = await bcrypt.compare(password, user.password);
    console.log("🔑 Password match:", isMatch);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};


exports.me = async function me(req, res, next) {
  try {
    if (!req.user || !req.user.id)
      return res.status(401).json({ message: "Not authenticated" });

    const user = await User.findById(req.user.id)
      .select("email employeeId role company site lastLoginDate")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ user });
  } catch (err) {
    next(err);
  }
};

exports.logout = function logout(req, res) {
  // Clear cookie with same options
  res.clearCookie("token", cookieOptions());
  res.json({ message: "Logged out" });
};
