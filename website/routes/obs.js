const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, getOne, runQuery } = require('../../shared/database');
const { checkLimit, teamFlag } = require('../services/planService');
const { deliverWebhooks } = require('../services/webhookService');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const teams = await getAll(
      'SELECT t.id FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id WHERE t.owner_id = ? OR tm.user_id = ? GROUP BY t.id LIMIT 1',
      [req.user.id, req.user.id]
    );
    if (teams.length === 0) return res.redirect('/teams');
    res.redirect(`/obs/${teams[0].id}`);
  } catch (err) {
    res.redirect('/teams');
  }
});

router.get('/:teamId', isAuthenticated, teamAccess, checkPermission('obs.view'), async (req, res) => {
  try {
    const connections = await getAll(
      'SELECT * FROM obs_connections WHERE team_id = ?',
      [req.team.id]
    );

    const overlayPresets = await getAll(
      'SELECT * FROM overlay_presets WHERE team_id = ? ORDER BY created_at DESC',
      [req.team.id]
    );

    const scenePresetsByConn = {};
    for (const conn of connections) {
      scenePresetsByConn[conn.id] = await getAll(
        'SELECT * FROM scene_presets WHERE conn_id = ? ORDER BY created_at DESC',
        [conn.id]
      );
    }

    const overlayOk = (await teamFlag(req.team.id, 'overlayPresets')).ok;
    const sceneOk = (await teamFlag(req.team.id, 'scenePresets')).ok;

    res.render('obs/dashboard', {
      title: 'OBS Control',
      team: req.team,
      connections,
      overlayPresets,
      scenePresetsByConn,
      overlayOk,
      sceneOk,
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
    const { name, host, port, password, type } = req.body;

    const { c: connCount } = await getOne('SELECT COUNT(*) AS c FROM obs_connections WHERE team_id = ?', [req.team.id]);
    const chk = await checkLimit(req.team.id, 'obsConnections', connCount);
    if (!chk.ok) {
      return res.redirect(
        `/obs/${req.team.id}/connections?error=${encodeURIComponent(`Your ${chk.plan.name} plan allows ${chk.limit} OBS connection${chk.limit === 1 ? '' : 's'}. Upgrade to add more.`)}`
      );
    }

    if (type === 'agent') {
      const agentToken = crypto.randomBytes(24).toString('hex');
      await runQuery(
        'INSERT INTO obs_connections (team_id, name, host, port, password, agent_token, public_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.team.id, name, 'agent', 0, '', agentToken, `conn_${crypto.randomBytes(8).toString('hex')}`]
      );
      res.redirect(`/obs/${req.team.id}/connections`);
    } else {
      await runQuery(
        'INSERT INTO obs_connections (team_id, name, host, port, password, public_id) VALUES (?, ?, ?, ?, ?, ?)',
        [req.team.id, name, host || '127.0.0.1', port || 4455, password || '', `conn_${crypto.randomBytes(8).toString('hex')}`]
      );
      res.redirect(`/obs/${req.team.id}/connections`);
    }
  } catch (err) {
    console.error(err);
    res.redirect(`/obs/${req.team.id}/connections?error=Failed to add connection`);
  }
});

router.get('/:teamId/connections/:connId/token', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    const conn = await getOne(
      'SELECT * FROM obs_connections WHERE id = ? AND team_id = ?',
      [req.params.connId, req.team.id]
    );
    if (!conn || !conn.agent_token) {
      return res.redirect(`/obs/${req.team.id}/connections`);
    }

    res.render('obs/agent', {
      title: 'OBS Agent Setup',
      team: req.team,
      conn
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/obs/${req.team.id}/connections`);
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

router.post('/:teamId/presets/overlay', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'overlayPresets');
    if (!chk.ok) {
      return res.redirect(`/obs/${req.team.id}?error=${encodeURIComponent(`Overlay presets are a ${chk.plan.name} plan feature.`)}`);
    }
    const { name, text } = req.body;
    if (!name || !text) return res.redirect(`/obs/${req.team.id}?error=${encodeURIComponent('Preset name and text are required.')}`);
    await runQuery('INSERT INTO overlay_presets (team_id, name, text) VALUES (?, ?, ?)', [req.team.id, name.trim(), text]);
    res.redirect(`/obs/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/obs/${req.team.id}?error=${encodeURIComponent('Failed to save overlay preset.')}`);
  }
});

router.post('/:teamId/presets/overlay/:id/delete', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    await runQuery('DELETE FROM overlay_presets WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    res.redirect(`/obs/${req.team.id}`);
  } catch (err) {
    res.redirect(`/obs/${req.team.id}`);
  }
});

router.post('/:teamId/presets/overlay/:id/apply', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    const preset = await getOne('SELECT * FROM overlay_presets WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    if (!preset) return res.redirect(`/obs/${req.team.id}`);
    const io = req.app.get('io');
    const conns = await getAll('SELECT id FROM obs_connections WHERE team_id = ?', [req.team.id]);
    for (const conn of conns) {
      await runQuery('UPDATE obs_connections SET overlay_text = ? WHERE id = ?', [preset.text, conn.id]);
      io.to(`overlay-${conn.id}`).emit('overlay-text', { text: preset.text });
    }
    res.redirect(`/obs/${req.team.id}?success=${encodeURIComponent(`Applied preset "${preset.name}" to all connections.`)}`);
  } catch (err) {
    res.redirect(`/obs/${req.team.id}`);
  }
});

router.post('/:teamId/connections/:connId/presets/scene', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'scenePresets');
    if (!chk.ok) {
      return res.redirect(`/obs/${req.team.id}?error=${encodeURIComponent(`Scene presets are a ${chk.plan.name} plan feature.`)}`);
    }
    const { name, scene_name } = req.body;
    if (!name || !scene_name) return res.redirect(`/obs/${req.team.id}?error=${encodeURIComponent('Preset name and scene are required.')}`);
    await runQuery('INSERT INTO scene_presets (conn_id, name, scene_name) VALUES (?, ?, ?)', [req.params.connId, name.trim(), scene_name]);
    res.redirect(`/obs/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/obs/${req.team.id}?error=${encodeURIComponent('Failed to save scene preset.')}`);
  }
});

router.post('/:teamId/connections/:connId/presets/scene/:id/apply', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    const preset = await getOne('SELECT * FROM scene_presets WHERE id = ? AND conn_id = ?', [req.params.id, req.params.connId]);
    if (!preset) return res.redirect(`/obs/${req.team.id}`);
    const io = req.app.get('io');
    io.to(`team-${req.team.id}`).emit('obs-command', { connId: req.params.connId, command: 'switchScene', scene: preset.scene_name });
    io.to(`agent-${req.params.connId}`).emit('agent-obs-command', { connId: req.params.connId, command: 'switchScene', scene: preset.scene_name });
    await deliverWebhooks(req.team.id, 'obs.scene_changed', { connId: req.params.connId, scene: preset.scene_name, via: 'preset' });
    res.redirect(`/obs/${req.team.id}?success=${encodeURIComponent(`Switching to "${preset.scene_name}".`)}`);
  } catch (err) {
    res.redirect(`/obs/${req.team.id}`);
  }
});

router.post('/:teamId/connections/:connId/presets/scene/:id/delete', isAuthenticated, teamAccess, checkPermission('obs.control'), async (req, res) => {
  try {
    await runQuery('DELETE FROM scene_presets WHERE id = ? AND conn_id = ?', [req.params.id, req.params.connId]);
    res.redirect(`/obs/${req.team.id}`);
  } catch (err) {
    res.redirect(`/obs/${req.team.id}`);
  }
});

module.exports = router;