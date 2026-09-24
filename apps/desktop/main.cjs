// Desktop-App: lädt den gebauten Web-Client über ein eigenes, sicheres Protokoll (app://),
// damit fetch(), Module und relative Pfade genauso funktionieren wie im Browser.
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const SMOKE = process.argv.includes('--smoke');
const clientDir = app.isPackaged ? path.join(process.resourcesPath, 'client') : path.join(__dirname, '..', 'client', 'dist');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600,
    backgroundColor: '#0b0f14', title: 'Project Zero', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  // Externe Links im Standardbrowser öffnen, nie in der App
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.loadURL('app://game/index.html');
  if (SMOKE) {
    // Prüflauf: warten, bis das Hauptmenü steht, Bildschirmfoto speichern, beenden
    win.webContents.once('did-finish-load', async () => {
      const ok = await win.webContents.executeJavaScript(`new Promise((r) => { const t0 = Date.now(); const i = setInterval(() => { const b = [...document.querySelectorAll('button')].some((x) => x.textContent === 'Einzelspieler'); if (b || Date.now() - t0 > 120000) { clearInterval(i); r(b); } }, 500); })`);
      await new Promise((r) => setTimeout(r, 5000)); // Ladebildschirm ausblenden lassen
      const img = await win.webContents.capturePage();
      const out = process.env.PZ_SMOKE_OUT || path.join(app.getPath('temp'), 'project-zero-smoke.png');
      fs.writeFileSync(out, img.toPNG());
      console.log(`[desktop] Hauptmenü ${ok ? 'geladen' : 'NICHT geladen'} – Bild: ${out}`);
      app.exit(ok ? 0 : 1);
    });
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(clientDir, decodeURIComponent(pathname)));
    if (!file.startsWith(clientDir)) return new Response('Verboten', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.on('pz:quit', () => app.quit());
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
