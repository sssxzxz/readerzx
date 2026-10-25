import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import type { HandlerDetails, MenuItemConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerStoreHandlers } from './ipc/storeHandlers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

app.setName('ereader');

const remoteDebuggingPort = process.env['EREADER_REMOTE_DEBUGGING_PORT'];
if (remoteDebuggingPort && /^\d+$/.test(remoteDebuggingPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: '阅读器',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', false);
  });

  mainWindow.webContents.setWindowOpenHandler((details: HandlerDetails) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '设置',
          accelerator: 'F10',
          click: () => mainWindow?.webContents.send('menu:toggle-settings'),
        },
        {
          label: '目录',
          accelerator: 'F4',
          click: () => mainWindow?.webContents.send('menu:toggle-toc'),
        },
        {
          label: '笔记 / 高亮',
          accelerator: 'F2',
          click: () => mainWindow?.webContents.send('menu:toggle-notes'),
        },
        { type: 'separator' },
        {
          label: '自动翻页',
          accelerator: 'F9',
          click: () => mainWindow?.webContents.send('menu:toggle-auto'),
        },
        {
          label: '朗读',
          accelerator: 'F6',
          click: () => mainWindow?.webContents.send('menu:toggle-tts'),
        },
        {
          label: '沉浸阅读模式',
          accelerator: 'F8',
          click: () => mainWindow?.webContents.send('menu:toggle-immersive'),
        },
        { type: 'separator' },
        {
          label: '全屏',
          accelerator: 'F11',
          click: () => {
            if (!mainWindow) return;
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          },
        },
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => mainWindow?.webContents.send('menu:about'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerWindowHandlers(): void {
  ipcMain.handle('window:set-fullscreen', (_e, on?: boolean) => {
    if (!mainWindow) return false;
    const target = typeof on === 'boolean' ? on : !mainWindow.isFullScreen();
    mainWindow.setFullScreen(target);
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);
}

app.whenReady().then(() => {
  registerFileHandlers();
  registerStoreHandlers();
  registerWindowHandlers();
  buildMenu();
  createWindow();
  // Notify renderer when fullscreen state flips (e.g., user pressed Esc)
  app.on('browser-window-focus', (_e, win) => {
    win.webContents.send('window:fullscreen-changed', win.isFullScreen());
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 处理通过文件关联打开
const filePathFromArgv = process.argv.find((a) =>
  /\.(epub|mobi|azw3|fb2|pdf|txt)$/i.test(a),
);
if (filePathFromArgv) {
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('open-file-from-shell', filePathFromArgv);
    });
  });
}
