module.exports = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !Array.isArray(req.user.roles) || !allowedRoles.some(role => req.user.roles.includes(role))) {
    return res.status(403).json({ success: false, error: 'You do not have permission to perform this action' });
  }
  next();
};
