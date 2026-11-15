const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');

// Public URL of the deployed Tom app. Override with the TOM_URL environment variable.
// Placeholder on purpose: a public repository must not ship a working link.
const TOM_URL = process.env.TOM_URL || 'https://your-app.example.com/';

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 790,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    backgroundColor: '#e9f0ff',
    title: 'Tom',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Always fetch the newest published shell: the app UI lives online, not in the installer.
  const url = new URL(TOM_URL);
  url.searchParams.set('_t', String(Date.now()));
  win.loadURL(url.toString());
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  if (!process.env.TOM_URL && TOM_URL.indexOf('your-app.example.com') >= 0) {
    dialog.showErrorBox('Tom', '请先在 desktop/main.js 或环境变量 TOM_URL 中填入你自己的应用地址（见 README.md）');
    app.quit();
    return;
  }
  try { await session.defaultSession.clearCache(); } catch (e) { /* ignore */ }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('tom-win-min', () => { if (win) win.minimize(); });
ipcMain.on('tom-win-max', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('tom-win-close', () => { if (win) win.close(); });
