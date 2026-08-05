const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, getOne, runQuery } = require('../../shared/database');
const { teamPlan, teamFlag } = require('../services/planService');
const { getPlan } = require('../../shared/plans');
const { SUPPORTED_EVENTS, signPayload } = require('../services/webhookService');

router.get('/:teamId', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const discordServer = await getOne(
      'SELECT * FROM discord_servers WHERE team_id = ?',
      [req.team.id]
    );

    const discordRoles = await getAll(
      `SELECT dr.*, r.name as production_role_name
       FROM discord_roles dr
       INNER JOIN roles r ON r.id = dr.production_role_id
       WHERE dr.team_id = ?`,
      [req.team.id]
    );

    const productionRoles = await getAll(
      'SELECT * FROM roles WHERE team_id = ?',
      [req.team.id]
    );

    const webhooks = await getAll('SELECT * FROM webhooks WHERE team_id = ?', [req.team.id]);
    const apiTokens = await getAll(
      "SELECT id, team_id, name, substr(token, 1, 8) || '...' AS token_preview, last_used_at, created_at FROM api_tokens WHERE team_id = ?",
      [req.team.id]
    );

    const planKey = await teamPlan(req.team.id);
    const plan = getPlan(planKey);
    const webhooksFlag = await teamFlag(req.team.id, 'webhooks');
    const apiFlag = await teamFlag(req.team.id, 'apiAccess');

    res.render('settings/index', {
      title: 'Team Settings',
      team: req.team,
      discordServer,
      discordRoles,
      productionRoles,
      webhooks,
      apiTokens,
      plan,
      planKey,
      webhooksOk: webhooksFlag.ok,
      apiOk: apiFlag.ok,
      events: SUPPORTED_EVENTS
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load settings.', user: req.user });
  }
});

router.post('/:teamId/discord', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const { guild_id, guild_name, icon } = req.body;

    const existing = await getOne('SELECT id FROM discord_servers WHERE team_id = ?', [req.team.id]);
    if (existing) {
      await runQuery(
        'UPDATE discord_servers SET guild_id = ?, guild_name = ?, icon = ? WHERE team_id = ?',
        [guild_id, guild_name, icon || '', req.team.id]
      );
    } else {
      await runQuery(
        'INSERT INTO discord_servers (team_id, guild_id, guild_name, icon) VALUES (?, ?, ?, ?)',
        [req.team.id, guild_id, guild_name, icon || '']
      );
    }

    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [req.team.id, req.user.id, 'Discord server connected']
    );

    res.redirect(`/settings/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/settings/${req.team.id}`);
  }
});

router.post('/:teamId/discord-role', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const { discord_role_id, production_role_id } = req.body;
    await runQuery(
      'INSERT INTO discord_roles (team_id, discord_role_id, production_role_id) VALUES (?, ?, ?)',
      [req.team.id, discord_role_id, production_role_id]
    );
    res.redirect(`/settings/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/settings/${req.team.id}`);
  }
});

router.post('/:teamId/webhooks', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'webhooks');
    if (!chk.ok) {
      return res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent(`Webhooks are a ${chk.plan.name} plan feature. Upgrade to enable them.`)}`);
    }
    const { url, secret, events } = req.body;
    if (!url || !/^https?:\/\//.test(url)) {
      return res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent('Webhook URL must start with http(s)://')}`);
    }
    const selected = Array.isArray(events) ? events : [];
    await runQuery(
      'INSERT INTO webhooks (team_id, url, secret, events) VALUES (?, ?, ?, ?)',
      [req.team.id, url, secret || '', JSON.stringify(selected)]
    );
    res.redirect(`/settings/${req.team.id}?success=Webhook created.`);
  } catch (err) {
    console.error(err);
    res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent('Failed to create webhook.')}`);
  }
});

router.post('/:teamId/webhooks/:id/delete', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    await runQuery('DELETE FROM webhooks WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    res.redirect(`/settings/${req.team.id}`);
  } catch (err) {
    res.redirect(`/settings/${req.team.id}`);
  }
});

router.post('/:teamId/webhooks/:id/test', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const hook = await getOne('SELECT * FROM webhooks WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    if (!hook) return res.redirect(`/settings/${req.team.id}`);
    const body = JSON.stringify({ event: 'test', teamId: String(req.team.id), data: { message: 'This is a test webhook.' }, timestamp: new Date().toISOString() });
    const headers = { 'Content-Type': 'application/json' };
    if (hook.secret) headers['X-Production-Signature'] = signPayload(hook.secret, body);
    try {
      await fetch(hook.url, { method: 'POST', headers, body });
      res.redirect(`/settings/${req.team.id}?success=Test webhook sent.`);
    } catch (fetchErr) {
      res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent('Test webhook failed: ' + fetchErr.message)}`);
    }
  } catch (err) {
    res.redirect(`/settings/${req.team.id}`);
  }
});

router.post('/:teamId/api-tokens', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'apiAccess');
    if (!chk.ok) {
      return res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent(`API access is a ${chk.plan.name} plan feature. Upgrade to enable it.`)}`);
    }
    const { name } = req.body;
    if (!name) return res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent('Token name is required.')}`);
    const token = 'tkn_' + crypto.randomBytes(24).toString('hex');
    await runQuery('INSERT INTO api_tokens (team_id, name, token) VALUES (?, ?, ?)', [req.team.id, name, token]);
    res.redirect(`/settings/${req.team.id}?success=${encodeURIComponent(`Token created. Copy it now: ${token}`)}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/settings/${req.team.id}?error=${encodeURIComponent('Failed to create token.')}`);
  }
});

router.post('/:teamId/api-tokens/:id/delete', isAuthenticated, teamAccess, checkPermission('team.settings.manage'), async (req, res) => {
  try {
    await runQuery('DELETE FROM api_tokens WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    res.redirect(`/settings/${req.team.id}`);
  } catch (err) {
    res.redirect(`/settings/${req.team.id}`);
  }
});

module.exports = router;
