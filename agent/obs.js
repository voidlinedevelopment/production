const OBSWebSocket = require('obs-websocket-js').default;
const { EventEmitter } = require('events');

class OBSManager extends EventEmitter {
  constructor() {
    super();
    this.obs = null;
    this.connected = false;
    this.info = {
      currentScene: null,
      scenes: [],
      streaming: false,
      recording: false,
      fps: 0
    };
    this.error = null;
    this.reconnectTimer = null;
    this.enabled = false;
    this.previewTimer = null;
    this.previewEnabled = false;
  }

  getStatus() {
    return {
      obsConnected: this.connected,
      currentScene: this.info.currentScene,
      scenes: this.info.scenes,
      streaming: this.info.streaming,
      recording: this.info.recording,
      fps: this.info.fps,
      obsError: this.error
    };
  }

  async connect({ obsHost, obsPort, obsPassword } = {}) {
    this.enabled = true;
    if (this.obs && this.connected) return true;

    obsHost = obsHost || this._lastHost || '127.0.0.1';
    obsPort = obsPort || this._lastPort || 4455;
    if (obsPassword === undefined) obsPassword = this._lastPassword;

    try {
      this._createClient();
      await this.obs.connect(`ws://${obsHost}:${obsPort}`, obsPassword || undefined);
      this.connected = true;
      this.error = null;
      await this._refreshInfo();
      if (this.previewEnabled) this._startPreview();
      this.emit('status');
      this.emit('obs-status', { connected: true, info: this.info });
      return true;
    } catch (err) {
      this.error = err.message;
      this.emit('status');
      this.emit('obs-status', { connected: false, error: err.message });
      this._scheduleReconnect();
      return false;
    }
  }

  _createClient() {
    this.obs = new OBSWebSocket();
    this.obs.on('ConnectionClosed', () => {
      this.connected = false;
      this._stopPreview();
      this.emit('status');
      this.emit('obs-status', { connected: false });
      this._scheduleReconnect();
    });
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      this.info.currentScene = data.sceneName;
      this.emit('status');
      this.emit('obs-event', { event: 'CurrentProgramSceneChanged', data: { sceneName: data.sceneName } });
    });
    this.obs.on('StreamStateChanged', (data) => {
      this.info.streaming = data.outputActive;
      this.emit('status');
      this.emit('obs-event', { event: 'StreamStateChanged', data: { outputActive: data.outputActive } });
    });
    this.obs.on('RecordStateChanged', (data) => {
      this.info.recording = data.outputActive;
      this.emit('status');
      this.emit('obs-event', { event: 'RecordStateChanged', data: { outputActive: data.outputActive } });
    });
  }

  async _refreshInfo() {
    const [streamStatus, sceneList, recordStatus] = await Promise.all([
      this.obs.call('GetStreamStatus'),
      this.obs.call('GetSceneList'),
      this.obs.call('GetRecordStatus').catch(() => ({ outputActive: false }))
    ]);
    let stats = null;
    try {
      stats = await this.obs.call('GetStats');
    } catch (e) {}
    this.info = {
      currentScene: sceneList.currentProgramSceneName,
      scenes: sceneList.scenes.map((s) => s.sceneName),
      streaming: streamStatus.outputActive,
      recording: recordStatus.outputActive,
      fps: stats ? stats.activeFps : 0
    };
  }

  setPreviewEnabled(enabled) {
    this.previewEnabled = enabled;
    if (!this.connected) return;
    if (enabled) {
      this._startPreview();
    } else {
      this._stopPreview();
    }
  }

  _startPreview() {
    if (this.previewTimer || !this.connected) return;
    this._capturePreview();
    this.previewTimer = setInterval(() => this._capturePreview(), 2000);
  }

  _stopPreview() {
    if (this.previewTimer) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
  }

  async _capturePreview() {
    if (!this.obs || !this.connected) return;
    try {
      const source = this.info.currentScene || (this.info.scenes && this.info.scenes[0]);
      if (!source) return;
      const shot = await this.obs.call('GetSourceScreenshot', {
        sourceName: source,
        imageFormat: 'jpg',
        imageWidth: 480,
        imageHeight: 270,
        imageCompressionQuality: 60
      });
      if (shot && shot.imageData) {
        const raw = String(shot.imageData).replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '');
        this.emit('preview', {
          image: raw,
          width: shot.imageWidth || 480,
          height: shot.imageHeight || 270
        });
      }
    } catch (e) {
      console.error('[preview] capture failed:', e.message);
    }
  }

  _scheduleReconnect() {
    if (!this.enabled || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect({
        obsHost: this._lastHost,
        obsPort: this._lastPort,
        obsPassword: this._lastPassword
      });
    }, 5000);
  }

  async disconnect() {
    this.enabled = false;
    this._stopPreview();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.obs) {
      try { await this.obs.disconnect(); } catch (e) {}
    }
    this.connected = false;
    this.emit('status');
  }

  async changeScene(sceneName) {
    if (!this.obs || !this.connected) throw new Error('OBS not connected');
    await this.obs.call('SetCurrentProgramScene', { sceneName });
    this.info.currentScene = sceneName;
    this.emit('status');
  }

  async startStream() {
    if (!this.obs || !this.connected) throw new Error('OBS not connected');
    await this.obs.call('StartStream');
    this.info.streaming = true;
    this.emit('status');
  }

  async stopStream() {
    if (!this.obs || !this.connected) throw new Error('OBS not connected');
    await this.obs.call('StopStream');
    this.info.streaming = false;
    this.emit('status');
  }

  async startRecording() {
    if (!this.obs || !this.connected) throw new Error('OBS not connected');
    await this.obs.call('StartRecord');
    this.info.recording = true;
    this.emit('status');
  }

  async stopRecording() {
    if (!this.obs || !this.connected) throw new Error('OBS not connected');
    await this.obs.call('StopRecord');
    this.info.recording = false;
    this.emit('status');
  }

  async startVirtualCam() {
    if (this.obs && this.connected) {
      try { await this.obs.call('StartVirtualCam'); } catch (e) {}
    }
  }

  async stopVirtualCam() {
    if (this.obs && this.connected) {
      try { await this.obs.call('StopVirtualCam'); } catch (e) {}
    }
  }

  async _findInput(name) {
    const res = await this.obs.call('GetInputList').catch(() => ({ inputs: [] }));
    return res.inputs.find((i) => i.inputName === name);
  }

  async enableOverlay(connId) {
    if (!this.obs || !this.connected) throw new Error('OBS not connected');
    const name = 'ProductionOverlay';
    const url = `https://production.ocrp.cc/overlay/${connId}`;

    const existing = await this._findInput(name);
    if (existing) {
      await this.obs.call('SetInputSettings', { inputName: name, inputSettings: { url } });
      await this.obs.call('RefreshBrowserSource', { sourceName: name }).catch(() => {});
      return;
    }

    let sceneName = this.info.currentScene;
    if (!sceneName) {
      const scene = await this.obs.call('GetCurrentProgramScene');
      sceneName = scene.currentProgramSceneName;
    }
    if (!sceneName) throw new Error('No current scene');

    const video = await this.obs.call('GetVideoSettings').catch(() => ({ baseWidth: 1920, baseHeight: 1080 }));
    await this.obs.call('CreateInput', {
      sceneName,
      inputName: name,
      inputKind: 'browser_source',
      inputSettings: {
        url,
        width: video.baseWidth || 1920,
        height: video.baseHeight || 1080,
        fps: 30
      }
    });
  }

  async disableOverlay() {
    if (!this.obs || !this.connected) return;
    const existing = await this._findInput('ProductionOverlay');
    if (existing) {
      await this.obs.call('RemoveInput', { inputName: 'ProductionOverlay' }).catch(() => {});
    }
  }

  setConnectionConfig(config) {
    this._lastHost = config.obsHost;
    this._lastPort = config.obsPort;
    this._lastPassword = config.obsPassword;
  }
}

module.exports = OBSManager;
