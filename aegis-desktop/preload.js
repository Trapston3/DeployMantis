const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aegis', {
  startCluster: () => ipcRenderer.invoke('start-cluster'),
  loadDashboard: () => ipcRenderer.send('load-dashboard')
});
