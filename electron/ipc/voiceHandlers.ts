import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron';
import { VoiceController } from '../voiceController';

export function registerVoiceHandlers(getWindow: () => BrowserWindow | null) {
  const voice = new VoiceController();
  let owner: WebContents | null = null;
  ipcMain.handle('voice:start', (event, sessionId: unknown) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        typeof sessionId !== 'number' || !Number.isSafeInteger(sessionId)) return;
    owner = event.sender;
    voice.start(sessionId, (update) => {
      if (!event.sender.isDestroyed()) event.sender.send('voice:event', update);
    });
  });
  ipcMain.handle('voice:stop', (event) => {
    if (event.sender === getWindow()?.webContents && event.senderFrame === event.sender.mainFrame) voice.stop();
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
      if (contents === owner && isMainFrame && !isInPlace) voice.stop();
    });
    contents.on('render-process-gone', () => {
      if (contents === owner) voice.stop();
    });
    contents.on('destroyed', () => {
      if (contents === owner) { voice.stop(); owner = null; }
    });
  });
  app.on('before-quit', () => voice.stop());
}
