const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let backendProcess = null;

function projectPath(...parts) {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(root, ...parts);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackend(url, retries = 30) {
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await wait(500);
  }

  throw new Error(`Backend did not start in time: ${url}`);
}

function startBackend() {
  const backendDir = projectPath('backend');
  const backendEntry = path.join(backendDir, 'src', 'index.js');

  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: backendDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3001',
      JWT_SECRET: process.env.JWT_SECRET || 'desktop-chat-app-secret',
      DATA_PATH: path.join(app.getPath('userData'), 'data.json'),
      DB_PATH: path.join(app.getPath('userData'), 'chat.db')
    },
    stdio: 'ignore',
    windowsHide: true
  });
}

async function createWindow() {
  startBackend();
  await waitForBackend('http://127.0.0.1:3001/api/health');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#f4f8ff',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  await mainWindow.loadURL('http://127.0.0.1:3001');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
