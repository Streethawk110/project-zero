// Schmale, sichere Brücke zwischen Spiel und Desktop: nur „Beenden“.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pzDesktop', {
  quit: () => ipcRenderer.send('pz:quit'),
  platform: process.platform,
});
