const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, runQuery, getOne } = require('../../shared/database');
const { ENFORCE_PLANS, teamFlag } = require('../services/planService');

router.get('/:teamId', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    const roles = await getAll('SELECT * FROM roles WHERE team_id = ?', [req.team.id]);
    const permissions = await getAll('SELECT * FROM permissions', []);

    const rolesWithPerms = await Promise.all(roles.map(async (role) => {
      const rolePerms = await getAll(
        `SELECT p.id, p.name FROM permissions p
         INNER JOIN role_permissions rp ON rp.permission_id = p.id
         WHERE rp.role_id = ?`,
        [role.id]
      );
      return { ...role, permissions: rolePerms };
    }));

    const templates = await getAll('SELECT * FROM role_templates WHERE team_id = ? ORDER BY created_at DESC', [req.team.id]);
    const templatesWithCounts = await Promise.all(templates.map(async (tpl) => {
      let perms = [];
      try { perms = JSON.parse(tpl.permissions); } catch (e) { perms = []; }
      return { ...tpl, permissionCount: perms.length };
    }));
    const templateOk = (await teamFlag(req.team.id, 'roleTemplates')).ok;

    res.render('roles/index', {
      title: 'Roles & Permissions',
      team: req.team,
      roles: rolesWithPerms,
      allPermissions: permissions,
      templates: templatesWithCounts,
      templateOk
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load roles.', user: req.user });
  }
});

router.post('/:teamId/:roleId/save-template', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'roleTemplates');
    if (!chk.ok) {
      return res.redirect(`/roles/${req.team.id}?error=${encodeURIComponent(`Role templates are a ${chk.plan.name} plan feature.`)}`);
    }
    const { name } = req.body;
    if (!name) return res.redirect(`/roles/${req.team.id}`);
    const perms = await getAll('SELECT permission_id FROM role_permissions WHERE role_id = ?', [req.params.roleId]);
    await runQuery(
      'INSERT INTO role_templates (team_id, name, permissions, created_by) VALUES (?, ?, ?, ?)',
      [req.team.id, name, JSON.stringify(perms.map((p) => p.permission_id)), req.user.id]
    );
    res.redirect(`/roles/${req.team.id}?success=Template saved`);
  } catch (err) {
    console.error(err);
    res.redirect(`/roles/${req.team.id}`);
  }
});

router.post('/:teamId/templates/:templateId/delete', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    await runQuery('DELETE FROM role_templates WHERE id = ? AND team_id = ?', [req.params.templateId, req.team.id]);
    res.redirect(`/roles/${req.team.id}?success=Template deleted`);
  } catch (err) {
    console.error(err);
    res.redirect(`/roles/${req.team.id}`);
  }
});

router.post('/:teamId/:roleId/apply-template', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'roleTemplates');
    if (!chk.ok) {
      return res.redirect(`/roles/${req.team.id}?error=${encodeURIComponent(`Role templates are a ${chk.plan.name} plan feature.`)}`);
    }
    const tpl = await getOne('SELECT * FROM role_templates WHERE id = ? AND team_id = ?', [req.params.templateId, req.team.id]);
    if (!tpl) return res.redirect(`/roles/${req.team.id}`);
    let perms = [];
    try { perms = JSON.parse(tpl.permissions); } catch (e) { perms = []; }

    await runQuery('DELETE FROM role_permissions WHERE role_id = ?', [req.params.roleId]);
    for (const permId of perms) {
      await runQuery('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [req.params.roleId, permId]);
    }
    res.redirect(`/roles/${req.team.id}?success=Template applied to role`);
  } catch (err) {
    console.error(err);
    res.redirect(`/roles/${req.team.id}`);
  }
});

router.post('/:teamId/create', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.redirect(`/roles/${req.team.id}`);
    await runQuery('INSERT INTO roles (team_id, name) VALUES (?, ?)', [req.team.id, name]);
    res.redirect(`/roles/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/roles/${req.team.id}`);
  }
});

router.post('/:teamId/:roleId/permissions', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    const { permissions } = req.body;
    const roleId = req.params.roleId;

    await runQuery('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

    if (permissions && Array.isArray(permissions)) {
      for (const permId of permissions) {
        await runQuery('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, permId]);
      }
    }

    res.redirect(`/roles/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/roles/${req.team.id}`);
  }
});

router.post('/:teamId/:roleId/delete', isAuthenticated, teamAccess, checkPermission('roles.manage'), async (req, res) => {
  try {
    await runQuery('DELETE FROM role_permissions WHERE role_id = ?', [req.params.roleId]);
    await runQuery('DELETE FROM roles WHERE id = ? AND team_id = ?', [req.params.roleId, req.team.id]);
    res.redirect(`/roles/${req.team.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/roles/${req.team.id}`);
  }
});

module.exports = router;
