const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  connectObs: () => ipcRenderer.invoke('connect-obs'),
  disconnectObs: () => ipcRenderer.invoke('disconnect-obs'),
  setStartup: (enabled) => ipcRenderer.invoke('set-startup', enabled),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onStatus: (cb) => ipcRenderer.on('status', (e, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb())
});
