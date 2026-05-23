// Arquivo de preload - fornece APIs seguras do Electron para o renderer
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Versão do app
  appVersion: require('./package.json').version,
  // Plataforma
  platform: process.platform
});
