import { dialog, ipcMain, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { OpenedBook, BookFormat } from '../../shared/types';

const SUPPORTED_EXT = ['epub', 'mobi', 'azw3', 'fb2', 'pdf', 'txt'] as const;
const BOOK_CACHE_LIMIT = 3;

interface CachedBook {
  size: number;
  mtimeMs: number;
  book: OpenedBook;
}

const bookCache = new Map<string, CachedBook>();

function detectFormat(filePath: string): BookFormat | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return (SUPPORTED_EXT as readonly string[]).includes(ext)
    ? (ext as BookFormat)
    : null;
}

async function readBook(filePath: string): Promise<OpenedBook | null> {
  const format = detectFormat(filePath);
  if (!format) return null;
  try {
    const stat = await fs.stat(filePath);
    const cached = bookCache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      bookCache.delete(filePath);
      bookCache.set(filePath, cached);
      return cached.book;
    }

    const buf = await fs.readFile(filePath);
    const id = crypto
      .createHash('sha1')
      .update(filePath + ':' + stat.size)
      .digest('hex');
    // Convert Node Buffer to ArrayBuffer slice
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const book: OpenedBook = {
      id,
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      format,
      size: stat.size,
      data: ab as ArrayBuffer,
    };
    bookCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, book });
    while (bookCache.size > BOOK_CACHE_LIMIT) {
      const oldestPath = bookCache.keys().next().value as string | undefined;
      if (!oldestPath) break;
      bookCache.delete(oldestPath);
    }
    return book;
  } catch (err) {
    console.error('readBook failed:', err);
    return null;
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle('file:open-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: '打开电子书',
      properties: ['openFile'],
      filters: [
        {
          name: '所有支持的格式',
          extensions: [...SUPPORTED_EXT],
        },
        { name: 'EPUB', extensions: ['epub'] },
        { name: 'Mobi / AZW3', extensions: ['mobi', 'azw3'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'FictionBook', extensions: ['fb2'] },
        { name: '纯文本', extensions: ['txt'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return readBook(result.filePaths[0]);
  });

  ipcMain.handle('file:open-path', async (_e, filePath: string) => {
    return readBook(filePath);
  });
}
