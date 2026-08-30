// Arquivo de preload - fornece APIs seguras do Electron para o renderer
const { contextBridge, ipcRenderer } = require('electron');
const pkg = require('./package.json');

contextBridge.exposeInMainWorld('electron', {
  appVersion: pkg.version,
  webBuild: '99',
  platform: process.platform,
  isDesktop: true,
  auth: {
    getSavedLogin: () => ipcRenderer.invoke('auth:getSavedLogin'),
    hasStoredPassword: () => ipcRenderer.invoke('auth:hasStoredPassword'),
    getStoredPassword: () => ipcRenderer.invoke('auth:getStoredPassword'),
    saveCredentials: (login, senha) => ipcRenderer.invoke('auth:saveCredentials', login, senha),
    clearCredentials: () => ipcRenderer.invoke('auth:clearCredentials'),
    recriarJanela: () => ipcRenderer.invoke('auth:recriarJanela')
  }
});
