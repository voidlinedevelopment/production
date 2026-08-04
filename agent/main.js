const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const OBSManager = require('./obs');
const SocketManager = require('./socket');

const SERVER_URL = 'https://production.ocrp.cc';
const OBS_HOST = '127.0.0.1';

const DEFAULTS = {
  token: '',
  obsPort: 4455,
  obsPassword: ''
};

let win = null;
let tray = null;
let isQuitting = false;
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
      settings,
      version: app.getVersion()
    });
  }
}

function startConnections() {
  socketManager.connect({ serverUrl: SERVER_URL, token: settings.token });
  obsManager.setConnectionConfig({ obsHost: OBS_HOST, obsPort: settings.obsPort, obsPassword: settings.obsPassword });
}

socketManager.on('registered', () => {
  obsManager.connect({ obsHost: OBS_HOST, obsPort: settings.obsPort, obsPassword: settings.obsPassword });
  broadcast();
});

obsManager.on('status', broadcast);
socketManager.on('status', broadcast);

function createWindow() {
  win = new BrowserWindow({
    width: 470,
    height: 760,
    title: 'Production OBS Agent',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Production OBS Agent',
      click: () => {
        if (win) {
          win.show();
          win.focus();
        }
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Production OBS Agent');
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    broadcast();
  });
  autoUpdater.on('update-downloaded', () => {
    broadcast();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-downloaded');
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err.message);
  });
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 10000);
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

ipcMain.handle('connect-obs', () => obsManager.connect({ obsHost: OBS_HOST, obsPort: settings.obsPort, obsPassword: settings.obsPassword }));
ipcMain.handle('disconnect-obs', () => obsManager.disconnect());
ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});
ipcMain.handle('set-startup', (e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
});
ipcMain.handle('get-startup', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  setupAutoUpdater();
  if (settings.token) {
    startConnections();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win) {
      win.show();
      win.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // keep running in the tray
});
