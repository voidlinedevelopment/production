function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }
  res.status(403).render('error', {
    title: 'Access Denied',
    message: 'You must be an admin to access this page.',
    user: req.user
  });
}

module.exports = { requireAdmin };
