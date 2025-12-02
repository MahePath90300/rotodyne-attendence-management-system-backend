exports.requireRole = function (roles = []) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    const userRole = (req.user.role || '').toUpperCase();
    const allowed = Array.isArray(roles) ? roles.map(r => String(r).toUpperCase()) : [String(roles).toUpperCase()];
    if (!allowed.includes(userRole)) return res.status(403).json({ message: 'Forbidden' });
    next();
  };
};
