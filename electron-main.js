const { app, BrowserWindow, Menu, session, nativeImage, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// isDev built-in — evita dep externa (que ficaria em devDependencies e sumiria no .exe)
const isDev = !app.isPackaged;

const PROD_URL = 'https://app-rotina-production-f84e.up.railway.app/';

// Forçar Windows a agrupar/exibir o app com o nosso ID e ícone (não o do electron.exe)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.approtina.app');
}

// Desativa cache do Chromium interno (senão o Electron serve CSS/JS velhos mesmo
// após ?v=X mudar — ele confia no ETag e nem reavalia até o disk cache expirar)
app.commandLine.appendSwitch('disable-http-cache');

// Ícone: em prod, os ícones ficam em resources/ (extraResources) — fora do asar.
// Em dev, ficam em public/. Sem essa distinção, createFromPath falha silenciosamente
// quando aponta pra dentro do asar e o Windows cai no ícone padrão do Electron.
function carregarIcone() {
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, 'public');
  const candidatos = ['icon.ico', 'icon-512.png', 'icon-192.png', 'icon.png'];
  for (const nome of candidatos) {
    const p = path.join(base, nome);
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      console.log('[icon] carregado:', p);
      return img;
    }
  }
  console.log('[icon] nenhum encontrado em', base);
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

  // Reativa atalhos úteis mesmo sem menu bar (Ctrl+Shift+I = DevTools, Ctrl+R = reload)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.control && input.key.toLowerCase() === 'r') {
      mainWindow.webContents.reloadIgnoringCache();
      event.preventDefault();
    } else if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Dev: localhost com server.js rodando local.
  // Prod (empacotado): aponta pra Railway — sem server embutido, sem segredo no .exe.
  const startUrl = isDev ? 'http://localhost:3000' : PROD_URL;
  mainWindow.loadURL(startUrl);

  // Escala global menor (deixa as informações mais compactas)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(0.95);
  });

  // Windows: aplica AUMID+ícone nas propriedades da JANELA em cada momento crítico.
  // Uma chamada só nem sempre pega — Windows Explorer às vezes já cacheou.
  function aplicarAppDetails() {
    if (process.platform !== 'win32' || !mainWindow) return;
    try {
      // process.execPath aponta pro próprio App Rotina.exe (que tem ícone correto embutido)
      mainWindow.setAppDetails({
        appId: 'com.approtina.app',
        relaunchDisplayName: 'App Rotina',
        appIconPath: process.execPath,
        appIconIndex: 0
      });
    } catch (e) { console.log('[setAppDetails] falhou:', e.message); }
    if (APP_ICON) { try { mainWindow.setIcon(APP_ICON); } catch (e) {} }
  }

  // Abrir maximizado (janela grande por padrão)
  mainWindow.once('ready-to-show', () => {
    aplicarAppDetails();
    mainWindow.maximize();
    mainWindow.show();
    // Windows às vezes ignora setAppDetails do ready-to-show — reaplica após um tick
    setTimeout(aplicarAppDetails, 500);
    setTimeout(aplicarAppDetails, 2000);
  });

  // DevTools desativado (pode abrir com Ctrl+Shift+I se precisar)

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Remove menu global (Windows/Linux mostravam "App Rotina | Editar | Ver" no topo).
// Atalhos como Ctrl+Shift+I ainda funcionam via BrowserWindow default.
Menu.setApplicationMenu(null);

app.on('ready', async () => {
  // Limpa cache HTTP do Chromium interno pra garantir que CSS/JS novos entrem.
  // Sem isso, o Electron reusa disk cache mesmo quando o servidor manda arquivo novo.
  try { await session.defaultSession.clearCache(); } catch (e) {}
  createWindow();
  // Auto-update: em produção, checa GitHub Releases a cada boot.
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(err => console.log('[updater]', err.message));
    }, 3000);
  }
});

// Quando uma atualização já foi baixada em background, pergunta se quer reiniciar.
autoUpdater.on('update-downloaded', async () => {
  if (!mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Atualização disponível',
    message: 'Uma nova versão do App Rotina foi baixada.',
    detail: 'Reiniciar agora pra aplicar? Você pode continuar usando e reiniciar depois.',
    buttons: ['Reiniciar agora', 'Depois'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) autoUpdater.quitAndInstall();
});
autoUpdater.on('error', (err) => console.log('[updater] erro:', err.message));

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
