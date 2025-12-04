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

exports.login = async function login(req, res, next) {
  try {
    // 1) express-validator errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: errors.array() });
    }

    // 2) pull fields from body (role etc are optional)
    const { email, password, employeeId, company, site, role } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // 3) find user in DB
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 4) check password
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) {
      return res.status(401).json({ message: "Invalid password" });
    }

    // 5) OPTIONAL: enforce that selected role matches DB role
    const requestedRole = (role || "").toUpperCase();
    const actualRole = (user.role || "").toUpperCase();
    if (requestedRole && requestedRole !== actualRole) {
      return res.status(403).json({
        message: `You are registered as ${actualRole}, not ${requestedRole}.`,
      });
    }

    // 6) one-login-per-day for site engineer
    const dbRoleUpper = actualRole;
    if (dbRoleUpper === "SITE_ENGINEER") {
      const today = todayDateStringUTC();
      if (user.lastLoginDate === today) {
        return res.status(403).json({
          message:
            "Site engineers are allowed to login once per day. You have already logged in today.",
        });
      }
    }

    // 7) issue JWT – ALWAYS use DB role & site
    const token = generateToken({
      id: user._id,
      email: user.email,
      role: user.role,
      company: user.company,
      site: user.site,
    });

    res.cookie("token", token, cookieOptions());

    // payload returned to frontend
    const safeUser = {
      id: user._id,
      email: user.email,
      employeeId: user.employeeId,
      role: user.role,
      company: user.company,
      site: user.site,
      lastLoginDate: user.lastLoginDate,
    };

    // 8) update lastLoginDate for site engineer
    if (dbRoleUpper === "SITE_ENGINEER") {
      try {
        user.lastLoginDate = todayDateStringUTC();
        await user.save();
      } catch (saveErr) {
        console.error("Failed to update lastLoginDate", user._id, saveErr);
      }
    }

    // 9) optional session record
    try {
      await Session.create({
        user: user._id,
        date: todayDateStringUTC(),
        company: user.company,
        site: user.site,
        ip: req.ip || req.headers["x-forwarded-for"] || null,
        userAgent: req.get("User-Agent") || null,
      });
    } catch (sessErr) {
      console.error("Could not create session record", sessErr);
    }

    // 10) final response (only once!)
    return res.status(200).json({
      message: "Login successful",
      user: safeUser,
    });
  } catch (err) {
    next(err);
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
