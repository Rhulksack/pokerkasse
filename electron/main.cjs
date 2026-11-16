const { app, BrowserWindow, ipcMain, dialog, shell, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

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
  if (!sseClients.size) return;
  let line; try { line = JSON.stringify(JSON.parse(json)); } catch { return; }
  for (const res of sseClients) { try { res.write('data: ' + line + '\n\n'); } catch {} }
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

// ---------- Fernsteuerung übers Heimnetz (Handy) ----------
const sseClients = new Set();
let remoteServer = null;
let remotePort = null;

function lanAddresses() {
  const res = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const ll = /^169\.254\./.test(a.address);
      const virt = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vbox|Loopback/i.test(name);
      res.push({ ip: a.address, name, score: (priv ? 2 : 0) + (virt ? -3 : 0) + (ll ? -2 : 0) + (/^192\.168\./.test(a.address) ? 1 : 0) });
    }
  }
  return res.sort((x, y) => y.score - x.score).map((x) => x.ip);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function handleRemote(req, res) {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/time') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ now: Date.now() })); }
  if (url.pathname === '/api/data') { res.setHeader('Content-Type', 'application/json'); return res.end(readData() || 'null'); }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }
  if (url.pathname === '/api/game' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => {
      try {
        const { game, players } = JSON.parse(body);
        const cur = JSON.parse(readData() || 'null') || { version: 1, players: [], games: [] };
        const i = cur.games.findIndex((x) => x.id === game.id);
        if (i < 0) { res.statusCode = 404; return res.end('{}'); }
        cur.games[i] = mergeGame(cur.games[i], game);
        for (const p of players || []) if (!cur.players.some((x) => x.id === p.id)) cur.players.push(p);
        const json = JSON.stringify(cur, null, 2);
        writeData(json);
        broadcast(json, null);
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
      } catch (e) { res.statusCode = 400; res.end('{}'); }
    });
    return;
  }
  // Statische Dateien der App
  const root = path.join(__dirname, '../dist');
  let f = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!f.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (url.pathname === '/' || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  if (path.basename(f) === 'sw.js') { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}

function startRemote() {
  if (remoteServer && remotePort) return Promise.resolve(remoteInfo());
  return new Promise((resolve) => {
    const tryPort = (port, left) => {
      const srv = http.createServer(handleRemote);
      srv.once('error', () => { if (left > 0) tryPort(port + 1, left - 1); else resolve(remoteInfo()); });
      srv.listen(port, '0.0.0.0', () => { remoteServer = srv; remotePort = port; resolve(remoteInfo()); });
    };
    tryPort(8765, 10);
  });
}

function remoteInfo() {
  return { running: !!remoteServer, port: remotePort, ips: lanAddresses() };
}

ipcMain.handle('remote:start', () => startRemote());

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
app.on('window-all-closed', () => { if (remoteServer) remoteServer.close(); app.quit(); });
