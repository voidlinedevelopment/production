const { getOne, getAll } = require('../../shared/database');

function checkPermission(...requiredPermissions) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).redirect('/auth/discord');
      }

      if (!req.team) {
        return res.status(400).render('error', {
          title: 'No Team Selected',
          message: 'Please select a team first.',
          user: req.user
        });
      }

      // Check if user is team owner
      const team = await getOne('SELECT owner_id FROM teams WHERE id = ?', [req.team.id]);
      if (team && team.owner_id === req.user.id) {
        req.userPermissions = ['*'];
        return next();
      }

      // Get user's role in team
      const member = await getOne(
        'SELECT role_id FROM team_members WHERE team_id = ? AND user_id = ?',
        [req.team.id, req.user.id]
      );

      if (!member || !member.role_id) {
        return res.status(403).render('error', {
          title: 'Access Denied',
          message: 'You do not have a role in this team.',
          user: req.user
        });
      }

      // Get role permissions
      const permissions = await getAll(
        `SELECT p.name FROM permissions p
         INNER JOIN role_permissions rp ON rp.permission_id = p.id
         WHERE rp.role_id = ?`,
        [member.role_id]
      );

      const userPermissions = permissions.map(p => p.name);
      req.userPermissions = userPermissions;

      // Check required permissions
      if (requiredPermissions.length === 0) {
        return next();
      }

      if (userPermissions.includes('*')) {
        return next();
      }

      const hasPermission = requiredPermissions.every(perm => userPermissions.includes(perm));
      if (hasPermission) {
        return next();
      }

      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'You do not have permission to access this resource.',
        user: req.user
      });
    } catch (err) {
      console.error('Permission check error:', err);
      return res.status(500).render('error', {
        title: 'Error',
        message: 'An error occurred while checking permissions.',
        user: req.user
      });
    }
  };
}

module.exports = { checkPermission };
