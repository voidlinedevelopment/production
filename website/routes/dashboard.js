const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { getAll, getOne } = require('../../shared/database');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const teams = await getAll(
      `SELECT t.* FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.owner_id = ? OR tm.user_id = ?
       GROUP BY t.id`,
      [req.user.id, req.user.id]
    );

    const activeProductions = await getAll(
      `SELECT p.*, t.name as team_name FROM productions p
       INNER JOIN teams t ON t.id = p.team_id
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE (t.owner_id = ? OR tm.user_id = ?) AND p.status = 'live'
       ORDER BY p.start_time DESC`,
      [req.user.id, req.user.id]
    );

    const recentActivity = await getAll(
      `SELECT al.*, u.username, u.avatar, t.name as team_name
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN teams t ON t.id = al.team_id
       LEFT JOIN team_members tm ON tm.team_id = al.team_id AND tm.user_id = ?
       WHERE al.team_id IN (
         SELECT id FROM teams WHERE owner_id = ?
         UNION
         SELECT team_id FROM team_members WHERE user_id = ?
       )
       ORDER BY al.created_at DESC
       LIMIT 15`,
      [req.user.id, req.user.id, req.user.id]
    );

    const totalTeams = teams.length;
    const totalProductions = activeProductions.length;

    res.render('dashboard/index', {
      title: 'Dashboard',
      teams,
      activeProductions,
      recentActivity,
      totalTeams,
      totalProductions
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load dashboard.', user: req.user });
  }
});

module.exports = router;
