// Arquivo de preload - fornece APIs seguras do Electron para o renderer
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Versão do app
  appVersion: '1.0.0',
  // Plataforma
  platform: process.platform
});
