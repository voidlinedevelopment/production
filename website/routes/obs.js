const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, getOne, runQuery } = require('../../shared/database');

router.get('/:teamId', isAuthenticated, teamAccess, checkPermission('obs.view'), async (req, res) => {
  try {
    const connections = await getAll(
      'SELECT * FROM obs_connections WHERE team_id = ?',
      [req.team.id]
    );

    res.render('obs/dashboard', {
      title: 'OBS Control',
      team: req.team,
      connections,
      io: req.app.get('io')
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load OBS dashboard.', user: req.user });
  }
});

router.get('/:teamId/connections', isAuthenticated, teamAccess, checkPermission('obs.view'), async (req, res) => {
  try {
    const connections = await getAll(
      'SELECT * FROM obs_connections WHERE team_id = ?',
      [req.team.id]
    );

    res.render('obs/connections', {
      title: 'OBS Connections',
      team: req.team,
      connections
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load connections.', user: req.user });
  }
});

router.post('/:teamId/connections', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    const { name, host, port, password } = req.body;
    await runQuery(
      'INSERT INTO obs_connections (team_id, name, host, port, password) VALUES (?, ?, ?, ?, ?)',
      [req.team.id, name, host || '127.0.0.1', port || 4455, password || '']
    );
    res.redirect(`/obs/${req.team.id}/connections`);
  } catch (err) {
    console.error(err);
    res.redirect(`/obs/${req.team.id}/connections?error=Failed to add connection`);
  }
});

router.post('/:teamId/connections/:connId/delete', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    await runQuery('DELETE FROM obs_connections WHERE id = ? AND team_id = ?', [req.params.connId, req.team.id]);
    res.redirect(`/obs/${req.team.id}/connections`);
  } catch (err) {
    console.error(err);
    res.redirect(`/obs/${req.team.id}/connections`);
  }
});

module.exports = router;