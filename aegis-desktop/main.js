const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'Aegis Reliability Suite',
    backgroundColor: '#1c1c1c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load the launcher UI first
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handler to start docker-compose
ipcMain.handle('start-cluster', async () => {
  return new Promise((resolve, reject) => {
    const rootDir = path.resolve(__dirname, '..');
    console.log(`Starting cluster in ${rootDir}...`);
    
    exec('docker compose up -d', { cwd: rootDir }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error starting cluster: ${error.message}`);
        reject(error.message);
        return;
      }
      console.log('Cluster started successfully.');
      resolve(stdout);
    });
  });
});

// IPC handler to redirect to dashboard
ipcMain.on('load-dashboard', () => {
  if (mainWindow) {
    mainWindow.loadURL('http://localhost:3001');
  }
});
