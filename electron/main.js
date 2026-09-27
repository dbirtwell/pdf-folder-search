const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_DIR = path.join(__dirname, '..');

// Serve the UI from app://bundle/ instead of file:// so ES modules and the
// PDF.js worker load under a normal, secure origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// The folder the user picked. The renderer may only read files inside it.
let allowedRoot = null;

function isInsideRoot(p) {
  if (!allowedRoot || typeof p !== 'string') return false;
  const rel = path.relative(allowedRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertPdfInRoot(p) {
  if (!isInsideRoot(p) || !/\.pdf$/i.test(p)) {
    throw new Error('Access denied: file is outside the selected folder');
  }
}

// Recursively lists PDFs. relPath is "RootName/sub/file.pdf" with forward
// slashes, matching the browser's webkitRelativePath format.
async function listPdfs(root) {
  const rootName = path.basename(root) || root;
  const files = [];
  const errors = [];

  const toRel = (full) => [rootName, ...path.relative(root, full).split(path.sep)].join('/');

  async function visit(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: dir, message: `Could not open folder (${err.code || err.message})` });
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (/\.pdf$/i.test(entry.name)) {
        // Symlinked files are included; symlinked folders are skipped to avoid loops.
        if (entry.isFile() || (entry.isSymbolicLink() && (await fs.stat(full).catch(() => null))?.isFile())) {
          files.push({ path: full, relPath: toRel(full) });
        }
      }
    }
  }

  await visit(root);
  return { files, errors };
}

function registerIpc() {
  ipcMain.handle('choose-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a folder to search',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    allowedRoot = path.resolve(result.filePaths[0]);
    return { path: allowedRoot, name: path.basename(allowedRoot) || allowedRoot };
  });

  ipcMain.handle('list-pdfs', async () => {
    if (!allowedRoot) throw new Error('No folder selected');
    return listPdfs(allowedRoot);
  });

  ipcMain.handle('read-file', async (_event, filePath) => {
    assertPdfInRoot(filePath);
    const buf = await fs.readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  ipcMain.handle('open-file', async (_event, filePath) => {
    assertPdfInRoot(filePath);
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  });

  ipcMain.handle('show-in-folder', (_event, filePath) => {
    assertPdfInRoot(filePath);
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('save-report', async (event, { defaultName, data, kind }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const filters = kind === 'pdf'
      ? [{ name: 'PDF document', extensions: ['pdf'] }]
      : [{ name: 'Text file', extensions: ['txt'] }];
    const result = await dialog.showSaveDialog(win, {
      title: 'Save report',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters,
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return result.filePath;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 900,
    minWidth: 520,
    minHeight: 500,
    title: 'PDF Folder Search',
    icon: path.join(APP_DIR, 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Never open new windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.once('ready-to-show', () => win.show());
  win.loadURL('app://bundle/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(APP_DIR, decodeURIComponent(pathname));
    const rel = path.relative(APP_DIR, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
