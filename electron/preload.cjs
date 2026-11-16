const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
  openDataFolder: () => ipcRenderer.invoke('data:folder'),
  exportPdf: (html, fileName) => ipcRenderer.invoke('export:pdf', { html, fileName }),
  exportTxt: (text, fileName) => ipcRenderer.invoke('export:txt', { text, fileName }),
  onDataChanged: (cb) => { const h = (_e, json) => cb(JSON.parse(json)); ipcRenderer.on('data:changed', h); return () => ipcRenderer.removeListener('data:changed', h); },
  tvOpen: (gameId, auto) => ipcRenderer.invoke('tv:open', { gameId, auto }),
  tvClose: () => ipcRenderer.invoke('tv:close'),
  tvState: () => ipcRenderer.invoke('tv:state'),
  remoteStart: () => ipcRenderer.invoke('remote:start'),
  onTvChanged: (cb) => { const h = (_e, st) => cb(st); ipcRenderer.on('tv:changed', h); return () => ipcRenderer.removeListener('tv:changed', h); },
});
