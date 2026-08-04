const OBSWebSocket = require('obs-websocket-js').default;

class OBSService {
  constructor() {
    this.connections = new Map(); // connId -> { obs, connected, info }
  }

  async connect(connId, host, port, password) {
    try {
      if (this.connections.has(connId)) {
        await this.disconnect(connId);
      }

      const obs = new OBSWebSocket();
      const url = `ws://${host}:${port}`;

      await obs.connect(url, password || undefined);

      const status = await obs.call('GetStreamStatus');
      const sceneList = await obs.call('GetSceneList');
      const currentScene = sceneList.currentProgramSceneName;
      const scenes = sceneList.scenes.map(s => s.sceneName);

      const info = {
        streaming: status.outputActive,
        recording: false,
        currentScene,
        scenes,
        fps: 0
      };

      // Get stats
      try {
        const stats = await obs.call('GetStats');
        info.fps = stats.activeFps || 0;
      } catch (e) {}

      this.connections.set(connId, { obs, connected: true, info });

      // Set up event listeners
      obs.on('CurrentProgramSceneChanged', (data) => {
        info.currentScene = data.sceneName;
        this.emitToTeam('obs-scene', {
          connId,
          scene: data.sceneName,
          scenes: info.scenes
        });
      });

      obs.on('StreamStateChanged', (data) => {
        info.streaming = data.outputActive;
        this.emitToTeam('obs-stream-status', {
          connId,
          streaming: data.outputActive
        });
      });

      obs.on('RecordStateChanged', (data) => {
        info.recording = data.outputActive;
        this.emitToTeam('obs-recording-status', {
          connId,
          recording: data.outputActive
        });
      });

      obs.on('ConnectionClosed', () => {
        this.connections.delete(connId);
        this.emitToTeam('obs-status', { connId, connected: false });
      });

      return { success: true, info };
    } catch (err) {
      console.error(`OBS connect error for conn ${connId}:`, err.message);
      this.connections.delete(connId);
      return { success: false, error: err.message };
    }
  }

  async disconnect(connId) {
    const conn = this.connections.get(connId);
    if (conn) {
      try {
        conn.obs.disconnect();
      } catch (e) {}
      this.connections.delete(connId);
    }
  }

  async switchScene(connId, sceneName) {
    const conn = this.connections.get(connId);
    if (!conn || !conn.connected) {
      return { success: false, error: 'Not connected' };
    }

    try {
      await conn.obs.call('SetCurrentProgramScene', { sceneName });
      conn.info.currentScene = sceneName;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async startStream(connId) {
    const conn = this.connections.get(connId);
    if (!conn || !conn.connected) {
      return { success: false, error: 'Not connected' };
    }

    try {
      await conn.obs.call('StartStream');
      conn.info.streaming = true;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async stopStream(connId) {
    const conn = this.connections.get(connId);
    if (!conn || !conn.connected) {
      return { success: false, error: 'Not connected' };
    }

    try {
      await conn.obs.call('StopStream');
      conn.info.streaming = false;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async startRecording(connId) {
    const conn = this.connections.get(connId);
    if (!conn || !conn.connected) {
      return { success: false, error: 'Not connected' };
    }

    try {
      await conn.obs.call('StartRecord');
      conn.info.recording = true;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async stopRecording(connId) {
    const conn = this.connections.get(connId);
    if (!conn || !conn.connected) {
      return { success: false, error: 'Not connected' };
    }

    try {
      await conn.obs.call('StopRecord');
      conn.info.recording = false;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getStatus(connId) {
    const conn = this.connections.get(connId);
    if (!conn) return { connected: false };
    return { connected: conn.connected, info: conn.info };
  }

  emitToTeam(event, data) {
    // This will be called from the Socket.IO handler
    if (this.io) {
      this.io.to(`team-${data.teamId || ''}`).emit(event, data);
    }
  }

  setIO(io) {
    this.io = io;
  }
}

module.exports = new OBSService();
