const { getOne, runQuery } = require('../../shared/database');

const authController = {
  async getOrCreateUser(profile) {
    let user = await getOne('SELECT * FROM users WHERE discord_id = ?', [profile.id]);

    if (user) {
      await runQuery(
        'UPDATE users SET username = ?, global_name = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?',
        [profile.username, profile.global_name, profile.avatar, profile.id]
      );
      return await getOne('SELECT * FROM users WHERE discord_id = ?', [profile.id]);
    }

    const result = await runQuery(
      'INSERT INTO users (discord_id, username, global_name, avatar, email) VALUES (?, ?, ?, ?, ?)',
      [profile.id, profile.username, profile.global_name, profile.avatar, profile.email || null]
    );
    return await getOne('SELECT * FROM users WHERE id = ?', [result.id]);
  }
};

module.exports = authController;
