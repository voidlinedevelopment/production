const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const teamController = require('../controllers/teamController');
const { getAll, getOne } = require('../../shared/database');
const { getPlan } = require('../../shared/plans');
const { ENFORCE_PLANS, BILLING_URL, teamPlan, getUserPlan, checkUserLimit, checkLimit, teamFlag } = require('../services/planService');

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
      return res.render('teams/create', { title: 'Create Team', error: 'Team name is required.', billingUrl: BILLING_URL });
    }
    const { c: ownedCount } = await getOne('SELECT COUNT(*) AS c FROM teams WHERE owner_id = ?', [req.user.id]);
    const chk = await checkUserLimit(req.user.id, 'teams', ownedCount);
    if (!chk.ok) {
      return res.render('teams/create', {
        title: 'Create Team',
        error: `Your ${chk.plan.name} plan allows ${chk.limit} team${chk.limit === 1 ? '' : 's'}. Upgrade to create more teams.`,
        billingUrl: BILLING_URL
      });
    }
    const team = await teamController.createTeam(req.user.id, name.trim(), description);
    res.redirect(`/teams/${team.id}`);
  } catch (err) {
    console.error(err);
    res.render('teams/create', { title: 'Create Team', error: 'Failed to create team.', billingUrl: BILLING_URL });
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
    const planKey = await teamPlan(req.team.id);
    const plan = getPlan(planKey);
    const analyticsOk = (await teamFlag(req.team.id, 'analytics')).ok;
    const auditOk = (await teamFlag(req.team.id, 'auditLogs')).ok;

    let analytics = null;
    if (analyticsOk) {
      const byStatus = await getAll(
        'SELECT status, COUNT(*) AS c FROM productions WHERE team_id = ? GROUP BY status',
        [req.team.id]
      );
      const statusMap = { draft: 0, live: 0, completed: 0 };
      byStatus.forEach((r) => { if (statusMap[r.status] !== undefined) statusMap[r.status] = r.c; });
      const { c: totalItems } = await getOne(
        `SELECT COUNT(*) AS c FROM rundown_items ri
         INNER JOIN productions p ON p.id = ri.production_id
         WHERE p.team_id = ?`,
        [req.team.id]
      );
      analytics = { statusMap, totalItems };
    }

    res.render('teams/view', {
      title: req.team.name,
      team: req.team,
      members,
      roles,
      obsConnections,
      productions,
      discordServer,
      isOwner: req.isOwner,
      teamMember: req.teamMember,
      plan,
      planKey,
      analytics,
      analyticsOk,
      auditOk,
      billingUrl: BILLING_URL
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load team.', user: req.user });
  }
});

router.get('/:teamId/activity', isAuthenticated, teamAccess, async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'auditLogs');
    if (!chk.ok) {
      return res.redirect(`/teams/${req.team.id}?error=${encodeURIComponent(`Team audit logs are a ${chk.plan.name} plan feature.`)}`);
    }
    const activity = await getAll(
      `SELECT al.*, u.username, u.global_name, u.avatar, u.discord_id
       FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.team_id = ?
       ORDER BY al.created_at DESC LIMIT 200`,
      [req.team.id]
    );
    const planKey = await teamPlan(req.team.id);
    res.render('teams/activity', {
      title: 'Activity Log',
      team: req.team,
      activity,
      plan: getPlan(planKey),
      billingUrl: BILLING_URL
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load activity.', user: req.user });
  }
});

router.get('/:teamId/edit', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  const planKey = await teamPlan(req.team.id);
  const logoOk = (await teamFlag(req.team.id, 'customLogo')).ok;
  res.render('teams/edit', {
    title: 'Edit Team',
    team: req.team,
    plan: getPlan(planKey),
    logoOk,
    billingUrl: BILLING_URL
  });
});

router.put('/:teamId', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const { name, description, logo } = req.body;
    const planKey = await teamPlan(req.team.id);
    const logoOk = (await teamFlag(req.team.id, 'customLogo')).ok;
    if (logo && !logoOk) {
      return res.redirect(`/teams/${req.team.id}/edit?error=${encodeURIComponent(`Custom logos are a ${getPlan(planKey).name} plan feature.`)}`);
    }
    await teamController.updateTeam(req.team.id, name, description, logo);
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

    const { c: memberCount } = await getOne('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?', [req.team.id]);
    const chk = await checkLimit(req.team.id, 'members', memberCount);
    if (!chk.ok) {
      return res.redirect(
        `/teams/${req.team.id}?error=${encodeURIComponent(`Your ${chk.plan.name} plan allows ${chk.limit} members. Upgrade to add more.`)}`
      );
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