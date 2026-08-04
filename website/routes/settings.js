const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, getOne, runQuery } = require('../../shared/database');

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

    res.render('settings/index', {
      title: 'Team Settings',
      team: req.team,
      discordServer,
      discordRoles,
      productionRoles
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

module.exports = router;
