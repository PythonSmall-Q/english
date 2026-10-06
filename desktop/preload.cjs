const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('WB_RUNTIME', {
  apiBase: process.env.WB_API_BASE || 'https://fff-api.xmoj-script.uk/api/v1',
  platform: process.platform,
  appVersion: process.env.npm_package_version || '3.0.0',
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  nativeUnlock: () => ipcRenderer.invoke('native-unlock'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  saveFile: (filename, data) => ipcRenderer.invoke('save-file', { filename, data }),
});