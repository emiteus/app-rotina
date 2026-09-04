const { app, BrowserWindow, Menu, session, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log/main');
const electronAuth = require('./lib/electron-auth');
log.initialize();
log.transports.file.level = 'debug';
autoUpdater.logger = log;

// isDev built-in — evita dep externa (que ficaria em devDependencies e sumiria no .exe)
const isDev = !app.isPackaged;

const PROD_URL = 'https://app-rotina-production-f84e.up.railway.app/';
/** Versão do frontend web — manter igual ao ?v= do index.html */
const WEB_BUILD = '134';

function urlProducao() {
  return `${PROD_URL}?v=${WEB_BUILD}&electron=1&_=${Date.now()}`;
}

// Forçar Windows a agrupar/exibir o app com o nosso ID e ícone (não o do electron.exe).
// Sufixo com versão força Windows a tratar como app "novo" e re-cachear o ícone —
// sem isso, a taskbar do Win11 mantém o átomo padrão do Electron cacheado.
const APP_VERSION = require('./package.json').version.replace(/\./g, '_');
const AUMID = `com.approtina.app.v${APP_VERSION}`;
if (process.platform === 'win32') {
  app.setAppUserModelId(AUMID);
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
let currentPartition = null;

// Protege contra múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

function registrarIpcAuth() {
  ipcMain.handle('auth:getSavedLogin', () => electronAuth.getSavedLogin());
  ipcMain.handle('auth:hasStoredPassword', () => electronAuth.hasStoredPassword());
  ipcMain.handle('auth:getStoredPassword', () => electronAuth.getStoredPassword());
  ipcMain.handle('auth:saveCredentials', (_e, login, password) => {
    const prevLogin = electronAuth.getSavedLogin();
    const prevPartition = currentPartition;
    const result = electronAuth.saveCredentials(login, password);
    const newPartition = electronAuth.partitionForLogin(result.login);
    const precisaRecriar = prevLogin !== result.login || prevPartition !== newPartition;
    return { ...result, precisaRecriar };
  });
  ipcMain.handle('auth:clearCredentials', () => {
    electronAuth.clearCredentials();
    return { ok: true };
  });
  ipcMain.handle('auth:recriarJanela', () => {
    recriarJanelaUsuario();
    return { ok: true };
  });
}

function recriarJanelaUsuario() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const maximized = mainWindow.isMaximized();
  mainWindow.close();
  mainWindow = null;
  createWindow({ bounds, maximized });
}

function createWindow(opts = {}) {
  const savedLogin = electronAuth.getSavedLogin();
  currentPartition = electronAuth.partitionForLogin(savedLogin);
  mainWindow = new BrowserWindow({
    width: opts.bounds?.width || 1200,
    height: opts.bounds?.height || 800,
    x: opts.bounds?.x,
    y: opts.bounds?.y,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,          // esconde a barra "App Rotina | Editar | Ver"
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: currentPartition,
      preload: path.join(__dirname, 'electron-preload.js')
    },
    icon: APP_ICON,
    backgroundColor: '#09090B',
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
  const startUrl = isDev ? 'http://localhost:3000?v=' + WEB_BUILD : urlProducao();
  let paginaCarregou = false;
  let reloadForcado = false;

  function urlOffline(motivo) {
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>App Rotina</title></head>
<body style="margin:0;background:#09090B;color:#fafafa;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="max-width:440px;text-align:center;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 10px;">Sem conexão com o servidor</h1>
    <p style="color:#a1a1aa;line-height:1.55;margin:0 0 24px;">O app abriu, mas este PC não alcança o servidor agora. A internet está ok — quem não responde é o endereço do App Rotina.</p>
    <p style="color:#71717a;font-size:12px;margin:0 0 24px;">${motivo}</p>
    <button onclick="location.href='${PROD_URL}'" style="background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer;">Tentar de novo</button>
  </div>
</body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  function mostrarOffline(motivo) {
    if (!mainWindow || paginaCarregou) return;
    const atual = mainWindow.webContents.getURL() || '';
    if (atual.startsWith('http')) {
      paginaCarregou = true;
      return;
    }
    log.error('[load] offline', motivo);
    mainWindow.loadURL(urlOffline(motivo));
    mostrarJanela();
  }

  mainWindow.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    log.error('[load] fail', code, desc, url, 'main=', isMainFrame);
    if (isMainFrame && code !== -3) mostrarOffline(desc || String(code));
  });
  const loadTimeout = setTimeout(() => mostrarOffline('Tempo esgotado ao conectar.'), 20000);
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    log.info('[load] ok', url);
    if (url.startsWith('http')) {
      paginaCarregou = true;
      clearTimeout(loadTimeout);
      mainWindow.webContents.setZoomFactor(0.95);
      if (!reloadForcado && !isDev) {
        reloadForcado = true;
        mainWindow.webContents.reloadIgnoringCache();
      }
    }
  });

  // Limpa cache da PARTIÇÃO do usuário (persist:rotina-*).
  // clearCache no defaultSession NÃO afeta essa sessão — por isso o .exe ficava na UI antiga.
  const ses = mainWindow.webContents.session;
  Promise.resolve()
    .then(() => ses.clearCache())
    .then(() => ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }))
    .catch((e) => log.warn('[cache] limpeza falhou', e?.message || e))
    .finally(() => {
      if (!mainWindow) return;
      mainWindow.webContents.loadURL(startUrl, {
        extraHeaders: 'Cache-Control: no-cache, no-store\r\nPragma: no-cache\r\n'
      });
    });

  // Windows: aplica AUMID+ícone nas propriedades da JANELA em cada momento crítico.
  // Uma chamada só nem sempre pega — Windows Explorer às vezes já cacheou.
  function aplicarAppDetails() {
    if (process.platform !== 'win32' || !mainWindow) return;
    try {
      // process.execPath aponta pro próprio App Rotina.exe (que tem ícone correto embutido)
      mainWindow.setAppDetails({
        appId: AUMID,
        relaunchDisplayName: 'App Rotina',
        appIconPath: process.execPath,
        appIconIndex: 0
      });
    } catch (e) { console.log('[setAppDetails] falhou:', e.message); }
    if (APP_ICON) { try { mainWindow.setIcon(APP_ICON); } catch (e) {} }
  }

  // show() ANTES de maximize(): no Windows, maximize com a janela oculta
  // deixa o Chromium sem pintar (tela branca). hide/show também quebrava o atalho.
  function mostrarJanela() {
    if (!mainWindow) return;
    aplicarAppDetails();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    try { mainWindow.webContents.invalidate(); } catch (e) {}
  }

  mainWindow.once('ready-to-show', () => {
    if (opts.maximized) mainWindow.maximize();
    mostrarJanela();
    setTimeout(aplicarAppDetails, 400);
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mostrarJanela();
  }, 4000);

  // DevTools desativado (pode abrir com Ctrl+Shift+I se precisar)

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Remove menu global (Windows/Linux mostravam "App Rotina | Editar | Ver" no topo).
// Atalhos como Ctrl+Shift+I ainda funcionam via BrowserWindow default.
Menu.setApplicationMenu(null);

app.on('ready', async () => {
  registrarIpcAuth();
  // Limpa defaultSession E a partição persistente do usuário logado
  const partitions = ['persist:rotina-default'];
  try {
    const login = electronAuth.getSavedLogin();
    if (login) partitions.push(electronAuth.partitionForLogin(login));
  } catch (e) { /* ok */ }
  for (const p of partitions) {
    try {
      const ses = session.fromPartition(p);
      await ses.clearCache();
      await ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    } catch (e) { /* ok */ }
  }
  try { await session.defaultSession.clearCache(); } catch (e) {}
  try {
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage']
    });
  } catch (e) {}
  createWindow();
  // Auto-update: em produção, checa GitHub Releases a cada boot.
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(err => console.log('[updater]', err.message));
    }, 3000);
  }
});

autoUpdater.on('checking-for-update', () => log.info('[updater] checking...'));
autoUpdater.on('update-available', (info) => log.info('[updater] AVAILABLE:', info.version));
autoUpdater.on('update-not-available', (info) => log.info('[updater] not-available:', info.version));
autoUpdater.on('download-progress', (p) => log.info('[updater] progress:', Math.round(p.percent) + '%'));

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
  // (isSilent=true, isForceRunAfter=true) → NSIS oneClick roda invisível e reabre o app.
  if (response === 0) autoUpdater.quitAndInstall(true, true);
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
