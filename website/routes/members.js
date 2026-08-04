const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const teamController = require('../controllers/teamController');
const { getAll } = require('../../shared/database');

router.get('/:teamId', isAuthenticated, teamAccess, checkPermission('members.manage'), async (req, res) => {
  try {
    const members = await teamController.getTeamMembers(req.team.id);
    const roles = await getAll('SELECT * FROM roles WHERE team_id = ?', [req.team.id]);

    res.render('members/index', {
      title: 'Members',
      team: req.team,
      members,
      roles
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load members.', user: req.user });
  }
});

router.post('/:teamId/:userId/role', isAuthenticated, teamAccess, checkPermission('members.manage'), async (req, res) => {
  try {
    const { role_id } = req.body;
    await teamController.updateMemberRole(req.team.id, parseInt(req.params.userId), parseInt(role_id));
    await teamController.logActivity(req.team.id, req.user.id, 'Updated member role');
    res.redirect(`/members/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/members/${req.team.id}`);
  }
});

module.exports = router;
