const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");

function protect(req, res, next) {
  const token = (req.cookies && req.cookies.token) || null;

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // contains id, email, role etc.
    next();
  } catch (e) {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
}

module.exports = protect;
