// Arquivo de preload - fornece APIs seguras do Electron para o renderer
const { contextBridge } = require('electron');
const pkg = require('./package.json');

contextBridge.exposeInMainWorld('electron', {
  appVersion: pkg.version,
  webBuild: '94',
  platform: process.platform,
  isDesktop: true
});
