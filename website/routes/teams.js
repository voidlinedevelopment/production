const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const teamController = require('../controllers/teamController');
const { getAll, getOne } = require('../../shared/database');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const teams = await teamController.getUserTeams(req.user.id);
    res.render('teams/index', { title: 'My Teams', teams });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load teams.', user: req.user });
  }
});

router.get('/create', isAuthenticated, (req, res) => {
  res.render('teams/create', { title: 'Create Team' });
});

router.post('/create', isAuthenticated, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || name.trim().length === 0) {
      return res.render('teams/create', { title: 'Create Team', error: 'Team name is required.' });
    }
    const team = await teamController.createTeam(req.user.id, name.trim(), description);
    res.redirect(`/teams/${team.id}`);
  } catch (err) {
    console.error(err);
    res.render('teams/create', { title: 'Create Team', error: 'Failed to create team.' });
  }
});

router.get('/:teamId', isAuthenticated, teamAccess, async (req, res) => {
  try {
    const members = await teamController.getTeamMembers(req.team.id);
    const roles = await getAll('SELECT * FROM roles WHERE team_id = ?', [req.team.id]);
    const obsConnections = await getAll('SELECT * FROM obs_connections WHERE team_id = ?', [req.team.id]);
    const productions = await getAll(
      'SELECT * FROM productions WHERE team_id = ? ORDER BY start_time DESC LIMIT 5',
      [req.team.id]
    );
    const discordServer = await getOne('SELECT * FROM discord_servers WHERE team_id = ?', [req.team.id]);

    res.render('teams/view', {
      title: req.team.name,
      team: req.team,
      members,
      roles,
      obsConnections,
      productions,
      discordServer,
      isOwner: req.isOwner,
      teamMember: req.teamMember
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load team.', user: req.user });
  }
});

router.get('/:teamId/edit', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), (req, res) => {
  res.render('teams/edit', { title: 'Edit Team', team: req.team });
});

router.put('/:teamId', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const { name, description } = req.body;
    await teamController.updateTeam(req.team.id, name, description);
    await teamController.logActivity(req.team.id, req.user.id, 'Team settings updated');
    res.redirect(`/teams/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to update team.', user: req.user });
  }
});

router.delete('/:teamId', isAuthenticated, teamAccess, async (req, res) => {
  try {
    if (!req.isOwner) {
      return res.status(403).render('error', { title: 'Error', message: 'Only the owner can delete a team.', user: req.user });
    }
    await teamController.deleteTeam(req.team.id);
    res.redirect('/teams');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to delete team.', user: req.user });
  }
});

router.post('/:teamId/invite', isAuthenticated, teamAccess, checkPermission('members.manage'), async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.redirect(`/teams/${req.team.id}`);
    }

    const targetUser = await getOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!targetUser) {
      return res.redirect(`/teams/${req.team.id}?error=User not found`);
    }

    await teamController.addMember(req.team.id, targetUser.id);
    await teamController.logActivity(req.team.id, req.user.id, `Invited ${targetUser.username}`);
    res.redirect(`/teams/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/teams/${req.team.id}?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/:teamId/remove/:userId', isAuthenticated, teamAccess, checkPermission('members.manage'), async (req, res) => {
  try {
    if (parseInt(req.params.userId) === req.team.owner_id) {
      return res.status(403).render('error', { title: 'Error', message: 'Cannot remove the team owner.', user: req.user });
    }
    await teamController.removeMember(req.team.id, parseInt(req.params.userId));
    await teamController.logActivity(req.team.id, req.user.id, 'Removed a member');
    res.redirect(`/teams/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/teams/${req.team.id}?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;