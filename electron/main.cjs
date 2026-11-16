const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'pokerkasse-daten.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: 'Pokerkasse',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();

ipcMain.handle('data:load', () => {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(dataFile() + '.bak', 'utf8'));
    } catch {
      return null;
    }
  }
});

ipcMain.handle('data:save', (_e, json) => {
  const f = dataFile();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.renameSync(tmp, f);
  return true;
});

ipcMain.handle('data:folder', () => shell.openPath(app.getPath('userData')));

ipcMain.handle('export:pdf', async (e, { html, fileName }) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return false;
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  fs.writeFileSync(filePath, pdf);
  w.destroy();
  shell.openPath(filePath);
  return true;
});

ipcMain.handle('export:txt', async (e, { text, fileName }) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    defaultPath: path.join(app.getPath('documents'), fileName),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, text, 'utf8');
  return true;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
