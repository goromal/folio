// folio Electron shell — a thin desktop window that loads the same SPA the
// backend serves at /folio, so desktop and web stay identical (see the folio
// architecture: one frontend, one backend, one DB). No electron-builder; this is
// packaged on Nix by wrapping nixpkgs' electron over this directory.
const { app, BrowserWindow, shell } = require('electron');

const PORT = process.env.FOLIO_PORT || '6666';
const URL = process.env.FOLIO_URL || `http://localhost:${PORT}/folio`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'folio',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(URL);
  // Open external links (e.g. an exported Notion URL) in the system browser,
  // not inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
