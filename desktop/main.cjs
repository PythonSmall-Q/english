const { app, BrowserWindow, shell, dialog, ipcMain, Menu, safeStorage, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const apiBase = process.env.WB_API_BASE || 'https://fff-api.xmoj-script.uk/api/v1';
const frontendUpdateBase = process.env.WB_FRONTEND_UPDATE_BASE || 'https://fff.xmoj-script.uk';
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  const existing = BrowserWindow.getAllWindows()[0];
  if (!existing) return;
  if (existing.isMinimized()) existing.restore();
  existing.show();
  existing.focus();
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('native-unlock', async () => {
  if (process.platform === 'darwin' && typeof systemPreferences.promptTouchID === 'function') {
    await systemPreferences.promptTouchID('验证后解锁英语教师教学工作台');
    return { unlocked: true, method: 'touch-id' };
  }
  if (safeStorage.isEncryptionAvailable()) {
    return { unlocked: false, available: false, reason: '当前 Electron 平台没有可调用的交互式系统凭据提示' };
  }
  return { unlocked: false, available: false, reason: '系统安全存储不可用' };
});
ipcMain.handle('open-external', async (_event, url) => {
  const parsed = new URL(String(url || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅允许打开 HTTP(S) 下载地址');
  await shell.openExternal(parsed.toString());
  return { opened: true };
});

ipcMain.handle('save-file', async (_event, { filename, data }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: filename,
    title: '导出文件',
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, Buffer.from(data));
  return { canceled: false, filePath: result.filePath };
});

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
    let activeManifest = bundledManifest;
    try {
      activeManifest = JSON.parse(await fs.readFile(path.join(overlayRoot, 'update-manifest.json'), 'utf8'));
    } catch (_) {
      // 首次启动或旧版本覆盖目录不存在时使用随包清单。
    }
    if (isNewerVersion(remoteManifest.version, activeManifest.version)) {
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
    } else if (isNewerVersion(activeManifest.version, bundledManifest.version)) {
      activeRoot = overlayRoot;
    }
  } catch (error) {
    console.warn('[frontend-update] skipped:', error.message);
    try {
      const overlayManifest = JSON.parse(await fs.readFile(path.join(overlayRoot, 'update-manifest.json'), 'utf8'));
      if (isNewerVersion(overlayManifest.version, bundledManifest.version)) activeRoot = overlayRoot;
    } catch (_) {
      // 网络和覆盖目录均不可用时使用随包前端。
    }
  }
  return activeRoot;
}

async function createWindow() {
  const bundledRoot = path.join(__dirname, '..', 'teacher-workbench', 'frontend');
  const frontendRoot = bundledRoot;
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
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      const opensDevTools = input.key === 'F12' ||
        (input.key.toLowerCase() === 'i' && input.control && input.shift) ||
        (input.key.toLowerCase() === 'j' && input.control && input.shift);
      if (opensDevTools) event.preventDefault();
    });
  }

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
  // 启动时先完成前端版本选择，避免首屏已经加载随包旧资源后才在第二次启动切换。
  updateFrontend()
    .then((activeRoot) => {
      if (!window.isDestroyed()) return window.loadFile(path.join(activeRoot, 'index.html'));
      return null;
    })
    .catch((error) => {
      console.warn('[frontend-update] skipped:', error.message);
      if (!window.isDestroyed()) return window.loadFile(path.join(frontendRoot, 'index.html'));
      return null;
    });
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  // 生产包不显示 Electron 默认的 File/Edit/Window/Help 菜单。
  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow().catch((error) => console.error('[frontend-update] startup failed:', error));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});