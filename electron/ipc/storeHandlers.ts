import { app, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BookSettingsMap,
  DEFAULT_BINDINGS,
  DEFAULT_SETTINGS,
  Highlight,
  ReaderSettings,
  ReadingProgress,
  RecentBook,
} from '../../shared/types';

interface StoreSchema {
  settings: ReaderSettings;
  /** bookId -> dedicated reading settings */
  bookSettings: BookSettingsMap;
  progress: Record<string, ReadingProgress>;
  recent: RecentBook[];
  /** bookId -> highlights */
  notes: Record<string, Highlight[]>;
}

const createDefaultStore = (): StoreSchema => ({
    settings: DEFAULT_SETTINGS,
    bookSettings: {},
    progress: {},
    recent: [],
    notes: {},
});

let cache: StoreSchema | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'ereader.json');
}

function loadStore(): StoreSchema {
  if (cache) return cache;

  const defaults = createDefaultStore();
  const filePath = getStorePath();
  if (!existsSync(filePath)) {
    cache = clone(defaults);
    return cache;
  }

  try {
    const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoreSchema>;
    cache = {
      settings: mergeSettings(saved.settings),
      bookSettings: mergeBookSettings(saved.bookSettings),
      progress: saved.progress ?? {},
      recent: saved.recent ?? [],
      notes: saved.notes ?? {},
    };
  } catch (err) {
    console.error('load store failed:', err);
    cache = clone(defaults);
  }

  return cache;
}

function saveStore(): void {
  const filePath = getStorePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(loadStore(), null, 2), 'utf8');
}

function getValue<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
  return loadStore()[key];
}

function setValue<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
  loadStore()[key] = value;
  saveStore();
}

const RECENT_LIMIT = 200;

function mergeSettings(saved: Partial<ReaderSettings> | undefined): ReaderSettings {
  // Deep-merge nested objects so newly-introduced keys (e.g. new bindings,
  // new theme tokens) get sane defaults for users with old saved files.
  const merged: ReaderSettings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  merged.bindings = { ...DEFAULT_BINDINGS, ...(saved?.bindings ?? {}) } as typeof DEFAULT_BINDINGS;
  merged.customTheme = {
    ...DEFAULT_SETTINGS.customTheme,
    ...(saved?.customTheme ?? {}),
  };
  merged.clickActions = {
    ...DEFAULT_SETTINGS.clickActions,
    ...(saved?.clickActions ?? {}),
  };
  merged.wheelActions = {
    ...DEFAULT_SETTINGS.wheelActions,
    ...(saved?.wheelActions ?? {}),
  };
  merged.dragHighlightActions = {
    ...DEFAULT_SETTINGS.dragHighlightActions,
    ...(saved?.dragHighlightActions ?? {}),
  };
  return merged;
}

function mergeBookSettings(saved: BookSettingsMap | undefined): BookSettingsMap {
  const out: BookSettingsMap = {};
  if (!saved || typeof saved !== 'object') return out;
  for (const [bookId, settings] of Object.entries(saved)) {
    out[bookId] = mergeSettings(settings);
  }
  return out;
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:load-settings', () => {
    const saved = getValue('settings') as Partial<ReaderSettings> | undefined;
    return mergeSettings(saved);
  });
  ipcMain.handle('store:save-settings', (_e, s: ReaderSettings) => {
    setValue('settings', s);
  });
  ipcMain.handle('store:load-book-settings', (_e, bookId: string) => {
    const all = getValue('bookSettings') ?? {};
    return all[bookId] ? mergeSettings(all[bookId]) : null;
  });
  ipcMain.handle('store:save-book-settings', (_e, bookId: string, s: ReaderSettings) => {
    const all = getValue('bookSettings') ?? {};
    all[bookId] = mergeSettings(s);
    setValue('bookSettings', all);
  });
  ipcMain.handle('store:delete-book-settings', (_e, bookId: string) => {
    const all = getValue('bookSettings') ?? {};
    delete all[bookId];
    setValue('bookSettings', all);
  });

  ipcMain.handle('store:load-progress', (_e, bookId: string) => {
    const all = getValue('progress');
    return all[bookId] ?? null;
  });
  ipcMain.handle('store:save-progress', (_e, p: ReadingProgress) => {
    const all = getValue('progress');
    all[p.bookId] = p;
    setValue('progress', all);
  });

  ipcMain.handle('store:load-recent', () => getValue('recent'));
  ipcMain.handle('store:add-recent', (_e, b: RecentBook) => {
    const list = getValue('recent').filter((x) => x.id !== b.id);
    list.unshift(b);
    setValue('recent', list.slice(0, RECENT_LIMIT));
  });
  ipcMain.handle('store:remove-recent', (_e, bookId: string) => {
    const store = loadStore();
    store.recent = store.recent.filter((x) => x.id !== bookId);
    delete store.progress[bookId];
    saveStore();
  });
  ipcMain.handle('store:clear-recent', () => {
    setValue('recent', []);
  });

  // ===== Notes / Highlights =====
  ipcMain.handle('notes:list', (_e, bookId: string) => {
    const all = (getValue('notes') ?? {}) as Record<string, Highlight[]>;
    return all[bookId] ?? [];
  });
  ipcMain.handle('notes:save', (_e, bookId: string, list: Highlight[]) => {
    const all = (getValue('notes') ?? {}) as Record<string, Highlight[]>;
    all[bookId] = list;
    setValue('notes', all);
  });
  ipcMain.handle('notes:clear', (_e, bookId: string) => {
    const all = (getValue('notes') ?? {}) as Record<string, Highlight[]>;
    delete all[bookId];
    setValue('notes', all);
  });
}
