const http = require('http');
const { getOne } = require('../../shared/database');

class DiscordService {
  constructor() {
    this.botApiUrl = process.env.BOT_API_URL || `http://localhost:${process.env.BOT_PORT || 4000}`;
  }

  async getBotStatus() {
    return new Promise((resolve) => {
      const url = new URL(`${this.botApiUrl}/api/status`);
      const req = http.get({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 3000
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ online: false }); }
        });
      });

      req.on('error', () => resolve({ online: false }));
      req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
    });
  }

  async sendNotification(guildId, channelName, message) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({ guildId, channelName, message });
      const url = new URL(`${this.botApiUrl}/api/notify`);

      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ success: false }); }
        });
      });

      req.on('error', () => resolve({ success: false }));
      req.write(postData);
      req.end();
    });
  }

  async notifyTeam(teamId, message) {
    const discordServer = await getOne(
      'SELECT * FROM discord_servers WHERE team_id = ?',
      [teamId]
    );

    if (!discordServer) return { success: false, error: 'No Discord server connected' };

    return this.sendNotification(discordServer.guild_id, 'production', message);
  }
}

module.exports = new DiscordService();
