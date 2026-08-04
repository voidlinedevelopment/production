const { getOne } = require('../../shared/database');

async function teamAccess(req, res, next) {
  try {
    const teamId = req.params.teamId || req.params.id || req.body.team_id || req.query.team_id;

    if (!teamId) {
      req.team = null;
      req.teamMember = null;
      return next();
    }

    const team = await getOne('SELECT * FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      return res.status(404).render('error', {
        title: 'Team Not Found',
        message: 'The team you are looking for does not exist.',
        user: req.user
      });
    }

    req.team = team;

    // Check membership
    const member = await getOne(
      'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
      [team.id, req.user ? req.user.id : null]
    );

    req.teamMember = member;
    req.isOwner = team.owner_id === (req.user ? req.user.id : null);

    next();
  } catch (err) {
    console.error('Team access error:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'An error occurred.',
      user: req.user
    });
  }
}

module.exports = { teamAccess };
