const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('WB_RUNTIME', {
  apiBase: process.env.WB_API_BASE || 'https://fff-api.xmoj-script.uk/api/v1',
  platform: process.platform,
  saveFile: (filename, data) => ipcRenderer.invoke('save-file', { filename, data }),
});