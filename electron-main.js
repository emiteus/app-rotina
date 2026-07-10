const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// Forçar Windows a agrupar/exibir o app com o nosso ID e ícone (não o do electron.exe)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.approtina.app');
}

const APP_ICON = nativeImage.createFromPath(path.join(__dirname, 'public', 'icon.ico'));

let mainWindow;

// Protege contra múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Alguém tentou abrir uma segunda instância
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    },
    icon: APP_ICON,
    show: false // Não mostrar até estar pronto
  });

  // Em desenvolvimento, abre localhost:3000
  // Em produção, carrega o arquivo local
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, 'public/index.html')}`;

  mainWindow.loadURL(startUrl);

  // Escala global menor (deixa as informações mais compactas)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(0.95);
  });

  // Abrir maximizado (janela grande por padrão)
  mainWindow.once('ready-to-show', () => {
    // Reforça o ícone (em dev, Windows tende a usar o do electron.exe se não fizer isso)
    try { mainWindow.setIcon(APP_ICON); } catch (e) {}
    mainWindow.maximize();
    mainWindow.show();
  });

  // DevTools desativado (pode abrir com Ctrl+Shift+I se precisar)

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Cria menu
const template = [
  {
    label: 'App Rotina',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  },
  {
    label: 'Editar',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' }
    ]
  },
  {
    label: 'Ver',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
