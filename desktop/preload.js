const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tomDesktop', {
  min: () => ipcRenderer.send('tom-win-min'),
  max: () => ipcRenderer.send('tom-win-max'),
  close: () => ipcRenderer.send('tom-win-close')
});
