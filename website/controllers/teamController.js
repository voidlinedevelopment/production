const { getOne, getAll, runQuery } = require('../../shared/database');

const teamController = {
  async createTeam(userId, name, description) {
    const result = await runQuery(
      'INSERT INTO teams (owner_id, name, description) VALUES (?, ?, ?)',
      [userId, name, description || '']
    );

    const team = await getOne('SELECT * FROM teams WHERE id = ?', [result.id]);

    // Create default roles
    const ownerRole = await runQuery('INSERT INTO roles (team_id, name) VALUES (?, ?)', [team.id, 'Owner']);
    const adminRole = await runQuery('INSERT INTO roles (team_id, name) VALUES (?, ?)', [team.id, 'Admin']);
    const producerRole = await runQuery('INSERT INTO roles (team_id, name) VALUES (?, ?)', [team.id, 'Producer']);
    const operatorRole = await runQuery('INSERT INTO roles (team_id, name) VALUES (?, ?)', [team.id, 'Operator']);
    const viewerRole = await runQuery('INSERT INTO roles (team_id, name) VALUES (?, ?)', [team.id, 'Viewer']);

    // Get all permissions
    const allPerms = await getAll('SELECT * FROM permissions', []);

    // Assign permissions to roles
    const ownerPerms = allPerms.map(p => p.id);
    const adminPerms = allPerms.filter(p => !p.name.startsWith('obs.')).map(p => p.id);
    const producerPerms = allPerms.filter(p => p.name.startsWith('obs.') || p.name === 'production.manage' || p.name === 'production.view').map(p => p.id);
    const operatorPerms = allPerms.filter(p => p.name.startsWith('obs.')).map(p => p.id);
    const viewerPerms = allPerms.filter(p => p.name.endsWith('.view') || p.name === 'production.view').map(p => p.id);

    const rolePermSets = [
      { roleId: ownerRole.id, perms: ownerPerms },
      { roleId: adminRole.id, perms: adminPerms },
      { roleId: producerRole.id, perms: producerPerms },
      { roleId: operatorRole.id, perms: operatorPerms },
      { roleId: viewerRole.id, perms: viewerPerms }
    ];

    for (const { roleId, perms } of rolePermSets) {
      for (const permId of perms) {
        await runQuery('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, permId]);
      }
    }

    // Add owner as member with Owner role
    await runQuery(
      'INSERT INTO team_members (team_id, user_id, role_id) VALUES (?, ?, ?)',
      [team.id, userId, ownerRole.id]
    );

    // Log activity
    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [team.id, userId, 'Team created']
    );

    return team;
  },

  async getTeamById(teamId) {
    return await getOne('SELECT * FROM teams WHERE id = ?', [teamId]);
  },

  async getTeamMembers(teamId) {
    return await getAll(
      `SELECT tm.*, u.discord_id, u.username, u.global_name, u.avatar, u.email, r.name as role_name
       FROM team_members tm
       INNER JOIN users u ON u.id = tm.user_id
       LEFT JOIN roles r ON r.id = tm.role_id
       WHERE tm.team_id = ?
       ORDER BY tm.joined_at`,
      [teamId]
    );
  },

  async getUserTeams(userId) {
    return await getAll(
      `SELECT t.* FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.owner_id = ? OR tm.user_id = ?
       GROUP BY t.id`,
      [userId, userId]
    );
  },

  async addMember(teamId, userId, roleId) {
    const existing = await getOne(
      'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );
    if (existing) throw new Error('User is already a member');

    if (!roleId) {
      const viewerRole = await getOne(
        'SELECT id FROM roles WHERE team_id = ? AND name = ?',
        [teamId, 'Viewer']
      );
      roleId = viewerRole ? viewerRole.id : null;
    }

    const result = await runQuery(
      'INSERT INTO team_members (team_id, user_id, role_id) VALUES (?, ?, ?)',
      [teamId, userId, roleId]
    );

    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [teamId, userId, 'Member joined']
    );

    return result;
  },

  async removeMember(teamId, userId) {
    const member = await getOne(
      'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );
    if (!member) throw new Error('User is not a member');

    await runQuery('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);

    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [teamId, userId, 'Member removed']
    );
  },

  async updateMemberRole(teamId, userId, roleId) {
    await runQuery(
      'UPDATE team_members SET role_id = ? WHERE team_id = ? AND user_id = ?',
      [roleId, teamId, userId]
    );
  },

  async updateTeam(teamId, name, description) {
    await runQuery(
      'UPDATE teams SET name = ?, description = ? WHERE id = ?',
      [name, description || '', teamId]
    );
    return await getOne('SELECT * FROM teams WHERE id = ?', [teamId]);
  },

  async deleteTeam(teamId) {
    await runQuery('DELETE FROM teams WHERE id = ?', [teamId]);
  },

  async logActivity(teamId, userId, action) {
    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [teamId, userId, action]
    );
  }
};

module.exports = teamController;
