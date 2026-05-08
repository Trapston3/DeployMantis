const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deploymantis', {
  startCluster: () => ipcRenderer.invoke('start-cluster'),
  loadDashboard: () => ipcRenderer.send('load-dashboard')
});
