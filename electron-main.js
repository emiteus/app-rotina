const { app, BrowserWindow, Menu, nativeImage } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// Forçar Windows a agrupar/exibir o app com o nosso ID e ícone (não o do electron.exe)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.approtina.app');
}

// Ícone: tenta o .ico (multi-tamanho do Windows) e cai pro PNG 512 se falhar.
// Se o Windows ainda mostrar o ícone antigo, é cache: fecha a app, deleta
// %LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db e reinicia o explorer.
function carregarIcone() {
  const candidatos = [
    path.join(__dirname, 'public', 'icon.ico'),
    path.join(__dirname, 'public', 'icon-512.png'),
    path.join(__dirname, 'public', 'icon.png')
  ];
  for (const p of candidatos) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  }
  return null;
}
const APP_ICON = carregarIcone();

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
    autoHideMenuBar: true,          // esconde a barra "App Rotina | Editar | Ver"
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js')
    },
    icon: APP_ICON,
    show: false // Não mostrar até estar pronto
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

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
    if (APP_ICON) { try { mainWindow.setIcon(APP_ICON); } catch (e) {} }
    mainWindow.maximize();
    mainWindow.show();
  });

  // DevTools desativado (pode abrir com Ctrl+Shift+I se precisar)

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Remove menu global (Windows/Linux mostravam "App Rotina | Editar | Ver" no topo).
// Atalhos como Ctrl+Shift+I ainda funcionam via BrowserWindow default.
Menu.setApplicationMenu(null);

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
