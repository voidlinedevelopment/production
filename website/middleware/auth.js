function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/discord');
}

function isTeamMember(req, res, next) {
  // This is set by teamAccess middleware
  if (req.teamMember) {
    return next();
  }
  res.status(403).render('error', {
    title: 'Access Denied',
    message: 'You are not a member of this team.',
    user: req.user
  });
}

module.exports = { isAuthenticated, isTeamMember };
