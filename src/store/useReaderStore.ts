import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  Highlight,
  ReaderSettings,
  ReadingProgress,
  RecentBook,
  OpenedBook,
  ThemeColors,
  PRESET_THEMES,
} from '@shared/types';

export type View = 'home' | 'reader';

interface UiFlags {
  showSettings: boolean;
  showToc: boolean;
  showRecent: boolean;
  showNotes: boolean;
  /** Hide toolbar/progressbar so only text remains. */
  immersive: boolean;
  /** Native window fullscreen reflected from main process. */
  fullscreen: boolean;
  /** Auto-paging running */
  autoOn: boolean;
  /** Loading book */
  loading: boolean;
  /** Last error */
  error: string | null;
  /** Reader page progress 0..1 */
  progress: number;
  /** Latest format-specific reading location reported by the renderer. */
  currentLocation: string | null;
  /** Latest TOC href reported by the renderer, when available. */
  currentTocHref: string | null;
  /** Pending location to seek to (after a book opens) */
  seekTo: string | null;
  /** Bumps when external code wants to invoke nextPage/prevPage */
  pageNonce: number;
  pageDirection: 'next' | 'prev' | null;
  /** Bumps when keyboard/menu code wants to highlight the active selection. */
  selectionHighlightNonce: number;
  /** Bumps when keyboard/menu code wants to toggle TTS playback. */
  ttsToggleNonce: number;
  /**
   * When true, the reading area renders `cursor: none` everywhere
   * (including inside EPUB iframes). Toggled via the configurable
   * left/right-click actions.
   */
  cursorHidden: boolean;
}

interface ReaderStore extends UiFlags {
  globalSettings: ReaderSettings;
  settings: ReaderSettings;
  hasBookSettings: boolean;
  view: View;
  book: OpenedBook | null;
  recent: RecentBook[];
  notes: Highlight[];

  // Hydration
  hydrate: () => Promise<void>;

  // Settings
  setSettings: (patch: Partial<ReaderSettings>) => void;
  resetSettings: () => void;
  saveSettingsForCurrentBook: () => Promise<void>;
  removeSettingsForCurrentBook: () => Promise<void>;

  // Book lifecycle
  openByDialog: () => Promise<void>;
  openByPath: (p: string) => Promise<void>;
  openBook: (b: OpenedBook) => Promise<void>;
  removeFromShelf: (bookId: string) => Promise<void>;
  closeBook: () => void;

  // Progress
  updateProgress: (location: string, percent: number, tocHref?: string | null) => void;

  // UI flags
  toggleSettings: () => void;
  toggleToc: () => void;
  toggleRecent: () => void;
  toggleNotes: () => void;
  toggleAuto: () => void;
  toggleImmersive: () => void;
  toggleFullscreen: () => Promise<void>;
  setFullscreen: (on: boolean) => void;
  setCursorHidden: (on: boolean) => void;
  toggleCursorHidden: () => void;
  setError: (e: string | null) => void;

  // Notes
  addNote: (h: Highlight) => void;
  updateNote: (id: string, patch: Partial<Highlight>) => void;
  removeNote: (id: string) => void;
  clearNotes: () => void;

  // Paging trigger from outside
  triggerPage: (dir: 'next' | 'prev') => void;
  triggerSelectionHighlight: () => void;
  triggerTtsToggle: () => void;
}

function applyTheme(s: ReaderSettings) {
  const colors: ThemeColors =
    s.themeId === 'custom'
      ? s.customTheme
      : PRESET_THEMES[s.themeId as Exclude<typeof s.themeId, 'custom'>];
  const root = document.documentElement;
  root.style.setProperty('--reader-bg', colors.bg);
  root.style.setProperty('--reader-fg', colors.fg);
  root.style.setProperty('--reader-accent', colors.accent);
  root.style.setProperty('--reader-panel', colors.panel);
  root.style.setProperty('--reader-muted', colors.muted);
  root.style.setProperty('--reader-font', s.fontFamily);
}

/** Debounce IPC saveSettings so dragging the font slider doesn't thrash disk. */
let saveTimer: number | null = null;
function persistSettings(s: ReaderSettings) {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void window.api.saveSettings(s);
  }, 350);
}

let bookSaveTimer: number | null = null;
function persistBookSettings(bookId: string, s: ReaderSettings) {
  if (bookSaveTimer != null) window.clearTimeout(bookSaveTimer);
  bookSaveTimer = window.setTimeout(() => {
    bookSaveTimer = null;
    void window.api.saveBookSettings(bookId, s);
  }, 350);
}

let progressTimer: number | null = null;
function persistProgress(p: {
  bookId: string;
  location: string;
  percent: number;
  lastOpenedAt: number;
}) {
  if (progressTimer != null) window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    progressTimer = null;
    void window.api.saveProgress(p);
  }, 500);
}

let recentTimer: number | null = null;
function persistRecent(b: RecentBook) {
  if (recentTimer != null) window.clearTimeout(recentTimer);
  recentTimer = window.setTimeout(() => {
    recentTimer = null;
    void window.api.addRecent(b);
  }, 500);
}

/** Debounced persistence for the notes list. */
let notesTimer: number | null = null;
function persistNotes(bookId: string, list: Highlight[]) {
  if (notesTimer != null) window.clearTimeout(notesTimer);
  notesTimer = window.setTimeout(() => {
    notesTimer = null;
    void window.api.saveNotes(bookId, list);
  }, 300);
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  globalSettings: DEFAULT_SETTINGS,
  settings: DEFAULT_SETTINGS,
  hasBookSettings: false,
  view: 'home',
  book: null,
  recent: [],
  notes: [],

  showSettings: false,
  showToc: false,
  showRecent: false,
  showNotes: false,
  immersive: false,
  fullscreen: false,
  autoOn: false,
  loading: false,
  error: null,
  progress: 0,
  currentLocation: null,
  currentTocHref: null,
  seekTo: null,
  pageNonce: 0,
  pageDirection: null,
  selectionHighlightNonce: 0,
  ttsToggleNonce: 0,
  cursorHidden: false,

  hydrate: async () => {
    const settings = await window.api.loadSettings();
    const recent = await window.api.loadRecent();
    const fullscreen = await window.api.isFullscreen();
    set({ globalSettings: settings, settings, recent, fullscreen });
    applyTheme(settings);
    window.api.onFullscreenChange((on) => set({ fullscreen: on }));
  },

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    const b = get().book;
    const hasBookSettings = !!b && get().hasBookSettings;
    set(hasBookSettings ? { settings: next } : { settings: next, globalSettings: next });
    applyTheme(next);
    if (hasBookSettings && b) persistBookSettings(b.id, next);
    else persistSettings(next);
  },

  resetSettings: () => {
    const b = get().book;
    if (b && get().hasBookSettings) {
      set({ settings: DEFAULT_SETTINGS });
      applyTheme(DEFAULT_SETTINGS);
      void window.api.saveBookSettings(b.id, DEFAULT_SETTINGS);
      return;
    }
    set({ globalSettings: DEFAULT_SETTINGS, settings: DEFAULT_SETTINGS });
    applyTheme(DEFAULT_SETTINGS);
    void window.api.saveSettings(DEFAULT_SETTINGS);
  },

  saveSettingsForCurrentBook: async () => {
    const b = get().book;
    if (!b) return;
    const settings = get().settings;
    await window.api.saveBookSettings(b.id, settings);
    set({ hasBookSettings: true, settings });
  },

  removeSettingsForCurrentBook: async () => {
    const b = get().book;
    if (!b) return;
    await window.api.deleteBookSettings(b.id);
    const globalSettings = get().globalSettings;
    set({ hasBookSettings: false, settings: globalSettings });
    applyTheme(globalSettings);
  },

  openByDialog: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const book = await window.api.openFileDialog();
      if (book) await get().openBook(book);
    } catch (err) {
      console.error('open dialog failed:', err);
      set({ error: '打开书籍失败，请稍后重试。' });
    } finally {
      set({ loading: false });
    }
  },

  openByPath: async (p) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const book = await window.api.openFileByPath(p);
      if (book) await get().openBook(book);
      else set({ error: '文件不存在、不支持，或暂时无法读取。' });
    } catch (err) {
      console.error('open path failed:', err);
      set({ error: '打开书籍失败，请稍后重试。' });
    } finally {
      set({ loading: false });
    }
  },

  openBook: async (b) => {
    const [progress, notes, bookSettings] = await Promise.all([
      window.api.loadProgress(b.id),
      window.api.listNotes(b.id),
      window.api.loadBookSettings(b.id),
    ]);
    const activeSettings = bookSettings ?? get().globalSettings;
    set({
      book: b,
      view: 'reader',
      seekTo: progress?.location ?? null,
      progress: progress?.percent ?? 0,
      currentLocation: progress?.location ?? null,
      currentTocHref: null,
      notes: Array.isArray(notes) ? notes : [],
      settings: activeSettings,
      hasBookSettings: !!bookSettings,
    });
    applyTheme(activeSettings);
    await window.api.addRecent({
      id: b.id,
      path: b.path,
      name: b.name,
      format: b.format,
      lastOpenedAt: Date.now(),
      percent: progress?.percent ?? 0,
    });
    const recent = await window.api.loadRecent();
    set({ recent });
  },

  removeFromShelf: async (bookId) => {
    await window.api.removeRecent(bookId);
    const recent = await window.api.loadRecent();
    set({ recent });
  },

  closeBook: () => {
    set({
      book: null,
      view: 'home',
      seekTo: null,
      progress: 0,
      currentLocation: null,
      currentTocHref: null,
      autoOn: false,
      notes: [],
      showNotes: false,
      immersive: false,
      cursorHidden: false,
      settings: get().globalSettings,
      hasBookSettings: false,
    });
    applyTheme(get().globalSettings);
  },

  updateProgress: (location, percent, tocHref) => {
    const b = get().book;
    if (!b) return;
    set({
      progress: percent,
      currentLocation: location,
      currentTocHref: tocHref ?? get().currentTocHref,
    });
    persistProgress({
      bookId: b.id,
      location,
      percent,
      lastOpenedAt: Date.now(),
    });
    // Recent list update is also debounced by piggybacking on the same timer
    // (saveProgress + addRecent fire together when the timer flushes).
    persistRecent({
      id: b.id,
      path: b.path,
      name: b.name,
      format: b.format,
      lastOpenedAt: Date.now(),
      percent,
    });
  },

  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  toggleToc: () => set((s) => ({ showToc: !s.showToc })),
  toggleRecent: () => set((s) => ({ showRecent: !s.showRecent })),
  toggleNotes: () => set((s) => ({ showNotes: !s.showNotes })),
  toggleAuto: () => set((s) => ({ autoOn: !s.autoOn })),
  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),
  toggleFullscreen: async () => {
    const next = !get().fullscreen;
    const actual = await window.api.setFullscreen(next);
    set({ fullscreen: actual });
  },
  setFullscreen: (on) => set({ fullscreen: on }),
  setCursorHidden: (on) => set({ cursorHidden: on }),
  toggleCursorHidden: () => set((s) => ({ cursorHidden: !s.cursorHidden })),
  setError: (e) => set({ error: e }),

  addNote: (h) => {
    const list = [...get().notes, h];
    set({ notes: list });
    if (get().book) persistNotes(get().book!.id, list);
  },
  updateNote: (id, patch) => {
    const list = get().notes.map((n) => (n.id === id ? { ...n, ...patch } : n));
    set({ notes: list });
    if (get().book) persistNotes(get().book!.id, list);
  },
  removeNote: (id) => {
    const list = get().notes.filter((n) => n.id !== id);
    set({ notes: list });
    if (get().book) persistNotes(get().book!.id, list);
  },
  clearNotes: () => {
    set({ notes: [] });
    if (get().book) persistNotes(get().book!.id, []);
  },

  triggerPage: (dir) =>
    set((s) => ({ pageNonce: s.pageNonce + 1, pageDirection: dir })),
  triggerSelectionHighlight: () =>
    set((s) => ({ selectionHighlightNonce: s.selectionHighlightNonce + 1 })),
  triggerTtsToggle: () => set((s) => ({ ttsToggleNonce: s.ttsToggleNonce + 1 })),
}));
