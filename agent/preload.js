const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  connectObs: () => ipcRenderer.invoke('connect-obs'),
  disconnectObs: () => ipcRenderer.invoke('disconnect-obs'),
  setStartup: (enabled) => ipcRenderer.invoke('set-startup', enabled),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  sendPreviewChunk: (streamId, data) => ipcRenderer.send('preview-chunk', { streamId, data }),
  previewLiveOk: (codec) => ipcRenderer.send('preview-live-status', { ok: true, codec }),
  previewLiveFailed: (error) => ipcRenderer.send('preview-live-status', { ok: false, error }),
  onStatus: (cb) => ipcRenderer.on('status', (e, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (e, s) => cb(s)),
  onPreviewCommand: (cb) => ipcRenderer.on('preview-command', (e, enabled) => cb(enabled))
});
