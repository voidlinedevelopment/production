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

module.exports = router;
