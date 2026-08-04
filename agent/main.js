const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OBSManager = require('./obs');
const SocketManager = require('./socket');

const SERVER_URL = 'https://production.ocrp.cc';

const DEFAULTS = {
  token: '',
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: ''
};

let win = null;
let settings = { ...DEFAULTS };

const obsManager = new OBSManager();
const socketManager = new SocketManager(obsManager);

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {}
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {}
}

function broadcast() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('status', {
      ...socketManager.getStatus(),
      ...obsManager.getStatus(),
      settings
    });
  }
}

function startConnections() {
  socketManager.connect({ serverUrl: SERVER_URL, token: settings.token });
  obsManager.setConnectionConfig(settings);
}

socketManager.on('registered', () => {
  obsManager.connect(settings);
  broadcast();
});

obsManager.on('status', broadcast);
socketManager.on('status', broadcast);

function createWindow() {
  win = new BrowserWindow({
    width: 470,
    height: 760,
    title: 'Production OBS Agent',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (e, next) => {
  settings = {
    ...DEFAULTS,
    ...next,
    obsPort: parseInt(next.obsPort, 10) || 4455
  };
  saveSettings();
  startConnections();
  broadcast();
  return settings;
});

ipcMain.handle('connect-obs', () => obsManager.connect(settings));
ipcMain.handle('disconnect-obs', () => obsManager.disconnect());

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  if (settings.token) {
    startConnections();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
