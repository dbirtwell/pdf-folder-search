const { contextBridge, ipcRenderer } = require('electron');

// The only desktop features the UI can use. No direct Node or file access.
contextBridge.exposeInMainWorld('pdfSearchDesktop', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  listPdfs: () => ipcRenderer.invoke('list-pdfs'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  saveReport: (defaultName, data, kind) => ipcRenderer.invoke('save-report', { defaultName, data, kind }),
});
