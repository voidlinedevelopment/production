const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, runQuery } = require('../shared/database');

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

    res.render('roles/index', {
      title: 'Roles & Permissions',
      team: req.team,
      roles: rolesWithPerms,
      allPermissions: permissions
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load roles.', user: req.user });
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
