const { app, BrowserWindow, ipcMain, dialog, shell, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'pokerkasse-daten.json');

let mainWin = null;
let tvWin = null;
let tvGame = null;
let blocker = null;

function loadApp(win, hash) {
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL + (hash ? '#' + hash : ''));
  else win.loadFile(path.join(__dirname, '../dist/index.html'), hash ? { hash } : undefined);
}

function externalDisplay() {
  if (!mainWin) return null;
  const here = screen.getDisplayMatching(mainWin.getBounds()).id;
  return screen.getAllDisplays().find((d) => d.id !== here) || null;
}

function notify(ch, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload);
}

function tvState() {
  return { open: !!tvWin, gameId: tvGame, displays: screen.getAllDisplays().length, external: !!externalDisplay() };
}

function openTv(gameId, auto) {
  const ext = externalDisplay();
  if (auto && !ext) return tvState();
  if (tvWin) { tvGame = gameId; loadApp(tvWin, 'tv=' + gameId); return tvState(); }
  const b = (ext || screen.getDisplayMatching(mainWin.getBounds())).bounds;
  tvWin = new BrowserWindow({
    x: b.x + 40, y: b.y + 40, width: Math.min(1280, b.width - 80), height: Math.min(720, b.height - 80),
    backgroundColor: '#05060a', autoHideMenuBar: true, title: 'Pokerkasse – TV',
    icon: path.join(__dirname, '../build/icon.png'), fullscreen: !!ext,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  tvGame = gameId;
  loadApp(tvWin, 'tv=' + gameId);
  if (blocker == null) blocker = powerSaveBlocker.start('prevent-display-sleep');
  tvWin.on('closed', () => {
    tvWin = null; tvGame = null;
    if (blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
    notify('tv:changed', tvState());
  });
  setTimeout(() => notify('tv:changed', tvState()), 50);
  return tvState();
}

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
  mainWin = win;
  loadApp(win);
  win.on('closed', () => { mainWin = null; if (tvWin) tvWin.close(); });
}

ipcMain.handle('tv:open', (_e, { gameId, auto }) => openTv(gameId, auto));
ipcMain.handle('tv:close', () => { if (tvWin) tvWin.close(); return tvState(); });
ipcMain.handle('tv:state', () => tvState());

if (!app.requestSingleInstanceLock()) app.quit();

function readData() {
  try { return fs.readFileSync(dataFile(), 'utf8'); } catch { try { return fs.readFileSync(dataFile() + '.bak', 'utf8'); } catch { return null; } }
}

function writeData(json) {
  const f = dataFile();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.renameSync(tmp, f);
}

// Events werden nur angehängt: beim Speichern Events, die zwischenzeitlich vom Handy kamen, nicht verlieren.
function mergeGame(base, inc) {
  if (!base || !Array.isArray(base.events) || !Array.isArray(inc.events)) return inc;
  const seen = new Set(inc.events.map((e) => e.id));
  const extra = base.events.filter((e) => !seen.has(e.id));
  if (!extra.length) return inc;
  return { ...inc, events: [...inc.events, ...extra].sort((x, y) => x.at - y.at) };
}

function broadcast(json, exceptSender) {
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== exceptSender && !w.isDestroyed()) w.webContents.send('data:changed', json);
}

ipcMain.handle('data:load', () => { const j = readData(); try { return j ? JSON.parse(j) : null; } catch { return null; } });

ipcMain.handle('data:save', (_e, json) => {
  let out = json;
  try {
    const cur = JSON.parse(readData() || 'null');
    const inc = JSON.parse(json);
    if (cur && Array.isArray(cur.games) && Array.isArray(inc.games)) {
      let changed = false;
      inc.games = inc.games.map((g) => {
        const b = cur.games.find((x) => x.id === g.id);
        const m = mergeGame(b, g);
        if (m !== g) changed = true;
        return m;
      });
      if (changed) out = JSON.stringify(inc, null, 2);
    }
  } catch {}
  writeData(out);
  broadcast(out, out === json ? _e.sender : null);
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

app.whenReady().then(() => {
  createWindow();
  const changed = () => notify('tv:changed', tvState());
  screen.on('display-added', changed);
  screen.on('display-removed', () => {
    if (tvWin && !externalDisplay()) tvWin.setFullScreen(false);
    changed();
  });
});
app.on('window-all-closed', () => app.quit());
