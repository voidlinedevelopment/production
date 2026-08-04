const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  connectObs: () => ipcRenderer.invoke('connect-obs'),
  disconnectObs: () => ipcRenderer.invoke('disconnect-obs'),
  onStatus: (cb) => ipcRenderer.on('status', (e, d) => cb(d))
});
