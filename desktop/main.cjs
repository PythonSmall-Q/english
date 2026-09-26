const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const apiBase = process.env.WB_API_BASE || 'https://fff-api.xmoj-script.uk/api/v1';
const frontendUpdateBase = process.env.WB_FRONTEND_UPDATE_BASE || 'https://fff.xmoj-script.uk';

function isNewerVersion(remote, local) {
  const remoteParts = String(remote || '0').split('.').map(Number);
  const localParts = String(local || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(remoteParts.length, localParts.length); i += 1) {
    if ((remoteParts[i] || 0) !== (localParts[i] || 0)) return (remoteParts[i] || 0) > (localParts[i] || 0);
  }
  return false;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function updateFrontend() {
  const bundledRoot = path.join(__dirname, '..', 'teacher-workbench', 'frontend');
  const overlayRoot = path.join(app.getPath('userData'), 'frontend');
  const bundledManifest = JSON.parse(await fs.readFile(path.join(bundledRoot, 'update-manifest.json'), 'utf8'));
  let activeRoot = bundledRoot;
  try {
    const remoteManifest = await fetchJson(`${frontendUpdateBase}/update-manifest.json`);
    if (isNewerVersion(remoteManifest.version, bundledManifest.version)) {
      for (const file of remoteManifest.files || []) {
        if (file.includes('..') || path.isAbsolute(file)) throw new Error('非法更新文件路径');
        const response = await fetch(`${frontendUpdateBase}/${file}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
        const target = path.join(overlayRoot, file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      }
      await fs.writeFile(path.join(overlayRoot, 'update-manifest.json'), JSON.stringify(remoteManifest, null, 2));
      activeRoot = overlayRoot;
    } else {
      const overlayManifest = JSON.parse(await fs.readFile(path.join(overlayRoot, 'update-manifest.json'), 'utf8'));
      if (overlayManifest.version === remoteManifest.version) activeRoot = overlayRoot;
    }
  } catch (error) {
    console.warn('[frontend-update] skipped:', error.message);
  }
  return activeRoot;
}

async function createWindow() {
  const frontendRoot = await updateFrontend();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#f4f6f8',
    icon: path.join(frontendRoot, 'favicon.svg'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // file:// 页面属于不透明来源；放宽 API 会话 Cookie 的 SameSite 属性，保证登录后的 auth/me 能复用会话。
  const apiOrigin = new URL(apiBase).origin;
  window.webContents.session.webRequest.onHeadersReceived(
    { urls: [`${apiOrigin}/*`] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      const cookieKey = Object.keys(headers).find((key) => key.toLowerCase() === 'set-cookie');
      if (cookieKey) {
        headers[cookieKey] = headers[cookieKey].map((cookie) => {
          let value = cookie.replace(/;\s*SameSite=Lax/gi, '; SameSite=None');
          if (!/;\s*Secure/i.test(value)) value += '; Secure';
          return value;
        });
      }
      callback({ responseHeaders: headers });
    }
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadFile(path.join(frontendRoot, 'index.html'));
}

app.whenReady().then(() => {
  createWindow().catch((error) => console.error('[frontend-update] startup failed:', error));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});