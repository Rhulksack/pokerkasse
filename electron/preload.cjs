const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
  openDataFolder: () => ipcRenderer.invoke('data:folder'),
  exportPdf: (html, fileName) => ipcRenderer.invoke('export:pdf', { html, fileName }),
  exportTxt: (text, fileName) => ipcRenderer.invoke('export:txt', { text, fileName }),
});
