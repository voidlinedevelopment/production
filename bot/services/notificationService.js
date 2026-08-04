const http = require('http');

class NotificationService {
  constructor() {
    this.botApiUrl = process.env.BOT_API_URL || `http://localhost:${process.env.BOT_PORT || 4000}`;
  }

  async sendNotification(guildId, channelName, message) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.botApiUrl}/api/notify`);
      const postData = JSON.stringify({ guildId, channelName, message });

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
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ success: false, error: 'Invalid response' });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.write(postData);
      req.end();
    });
  }

  async notifyOBSConnected(guildId, channelName) {
    return this.sendNotification(guildId, channelName, '🟢 **OBS Connected**\nOBS Studio is now connected to Production.');
  }

  async notifyOBSDisconnected(guildId, channelName) {
    return this.sendNotification(guildId, channelName, '🔴 **OBS Disconnected**\nOBS Studio has been disconnected.');
  }

  async notifyStreamStarted(guildId, channelName, productionName) {
    return this.sendNotification(guildId, channelName, `🔴 **Stream Started**\n${productionName || 'Live broadcast'} is now live!`);
  }

  async notifyStreamEnded(guildId, channelName, productionName) {
    return this.sendNotification(guildId, channelName, `⚫ **Stream Ended**\n${productionName || 'Broadcast'} has ended.`);
  }

  async notifySceneChanged(guildId, channelName, sceneName) {
    return this.sendNotification(guildId, channelName, `🎬 **Scene Changed**\nSwitched to: ${sceneName}`);
  }

  async notifyMemberJoined(guildId, channelName, username) {
    return this.sendNotification(guildId, channelName, `👋 **Member Joined**\n${username} has joined the team.`);
  }
}

module.exports = new NotificationService();
