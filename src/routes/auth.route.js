const express = require("express");
const router = express.Router();
const { login, me, logout } = require("../controllers/auth.controller");
const protect = require("../middlewares/authMiddleware");
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");

const loginLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 15,
  message: { message: "Too many login attempts. Please try again later." },
});

// Validation rules for login using express-validator
const loginValidation = [
  body("email").isEmail().withMessage("Valid email required"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password required (min 6 chars)"),
  body("employeeId").notEmpty().withMessage("Employee ID required"),
  body("role").optional(),
];

router.post("/login", loginValidation, loginLimiter, login);

router.get("/me", protect, me);

router.post("/logout", logout);

module.exports = router;
