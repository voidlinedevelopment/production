const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { getAll, getOne, runQuery } = require('../../shared/database');

// Get team data
router.get('/teams', isAuthenticated, async (req, res) => {
  try {
    const teams = await getAll(
      `SELECT t.* FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.owner_id = ? OR tm.user_id = ?
       GROUP BY t.id`,
      [req.user.id, req.user.id]
    );
    res.json({ success: true, teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get team members
router.get('/teams/:teamId/members', isAuthenticated, async (req, res) => {
  try {
    const members = await getAll(
      `SELECT tm.*, u.discord_id, u.username, u.global_name, u.avatar, r.name as role_name
       FROM team_members tm
       INNER JOIN users u ON u.id = tm.user_id
       LEFT JOIN roles r ON r.id = tm.role_id
       WHERE tm.team_id = ?`,
      [req.params.teamId]
    );
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get OBS connections
router.get('/teams/:teamId/obs', isAuthenticated, async (req, res) => {
  try {
    const connections = await getAll(
      'SELECT id, name, host, port, status FROM obs_connections WHERE team_id = ?',
      [req.params.teamId]
    );
    res.json({ success: true, connections });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Log OBS activity
router.post('/obs/activity', isAuthenticated, async (req, res) => {
  try {
    const { team_id, action } = req.body;
    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [team_id, req.user.id, action]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search users
router.get('/users/search', isAuthenticated, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ success: true, users: [] });
    }
    const users = await getAll(
      'SELECT id, username, global_name, avatar FROM users WHERE username LIKE ? OR global_name LIKE ? LIMIT 10',
      [`%${q}%`, `%${q}%`]
    );
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Public API v1 (Bearer token) ----
const { getPlan } = require('../../shared/plans');

async function apiAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing Bearer token. Send: Authorization: Bearer <token>' });
  }
  try {
    const apiToken = await getOne('SELECT * FROM api_tokens WHERE token = ?', [token]);
    if (!apiToken) {
      return res.status(401).json({ success: false, error: 'Invalid API token.' });
    }
    req.apiTeamId = apiToken.team_id;
    req.apiToken = apiToken;
    await runQuery('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [apiToken.id]);
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function requireTeamForApi(req, res, next) {
  const teamId = parseInt(req.params.teamId, 10);
  if (!teamId || teamId !== req.apiTeamId) {
    return res.status(403).json({ success: false, error: 'Token is not valid for this team.' });
  }
  req.team = await getOne('SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!req.team) return res.status(404).json({ success: false, error: 'Team not found.' });
  next();
}

router.get('/v1/teams/:teamId', apiAuth, requireTeamForApi, async (req, res) => {
  const planKey = req.team.owner_id ? (await getTeamPlanIfAdmin(req.team.owner_id)) : 'free';
  const plan = getPlan(planKey);
  res.json({ success: true, team: { ...req.team, plan: planKey, plan_name: plan.name } });
});

router.get('/v1/teams/:teamId/productions', apiAuth, requireTeamForApi, async (req, res) => {
  const productions = await getAll('SELECT * FROM productions WHERE team_id = ? ORDER BY start_time DESC', [req.team.id]);
  res.json({ success: true, productions });
});

router.get('/v1/teams/:teamId/productions/:prodId', apiAuth, requireTeamForApi, async (req, res) => {
  const production = await getOne('SELECT * FROM productions WHERE id = ? AND team_id = ?', [req.params.prodId, req.team.id]);
  if (!production) return res.status(404).json({ success: false, error: 'Production not found.' });
  const rundown = await getAll('SELECT * FROM rundown_items WHERE production_id = ? ORDER BY position', [production.id]);
  res.json({ success: true, production, rundown });
});

router.get('/v1/teams/:teamId/members', apiAuth, requireTeamForApi, async (req, res) => {
  const members = await getAll(
    `SELECT tm.*, u.discord_id, u.username, u.global_name, u.avatar, r.name AS role_name
     FROM team_members tm
     INNER JOIN users u ON u.id = tm.user_id
     LEFT JOIN roles r ON r.id = tm.role_id
     WHERE tm.team_id = ?`,
    [req.team.id]
  );
  res.json({ success: true, members });
});

router.get('/v1/teams/:teamId/obs', apiAuth, requireTeamForApi, async (req, res) => {
  const connections = await getAll(
    'SELECT id, name, host, port, status, created_at FROM obs_connections WHERE team_id = ?',
    [req.team.id]
  );
  res.json({ success: true, connections });
});

router.get('/v1/teams/:teamId/activity', apiAuth, requireTeamForApi, async (req, res) => {
  const activity = await getAll(
    `SELECT al.id, al.action, al.details, al.created_at, u.username
     FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
     WHERE al.team_id = ?
     ORDER BY al.created_at DESC LIMIT 100`,
    [req.team.id]
  );
  res.json({ success: true, activity });
});

async function getTeamPlanIfAdmin(ownerId) {
  const { isAdmin } = require('../services/planService');
  if (await isAdmin(ownerId)) return 'studio';
  const sub = await getOne('SELECT plan, status FROM subscriptions WHERE team_id = (SELECT id FROM teams WHERE owner_id = ?) LIMIT 1', [ownerId]);
  if (sub && ['active', 'trialing'].includes(sub.status)) return sub.plan;
  return 'free';
}

module.exports = router;
