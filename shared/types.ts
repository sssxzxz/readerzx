export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'fb2' | 'pdf' | 'txt';

export interface OpenedBook {
  /** SHA1 hash for stable lookup */
  id: string;
  /** Absolute file path on disk */
  path: string;
  /** Display name (from metadata or filename) */
  name: string;
  /** File extension */
  format: BookFormat;
  /** File size in bytes */
  size: number;
  /** Raw bytes (transferred over IPC for renderer parsing) */
  data: ArrayBuffer;
}

export interface ReadingProgress {
  bookId: string;
  /** Format-specific location: foliate CFI, pdf page, txt char offset */
  location: string;
  /** 0..1 */
  percent: number;
  lastOpenedAt: number;
}

export interface RecentBook {
  id: string;
  path: string;
  name: string;
  format: BookFormat;
  lastOpenedAt: number;
  percent: number;
}

export type ThemeId = 'white' | 'sepia' | 'green' | 'gray' | 'dark' | 'black' | 'custom';
export type ReadingLayout = 'paginated' | 'vertical';

export interface ThemeColors {
  bg: string;
  fg: string;
  accent: string;
  panel: string;
  muted: string;
}

export interface KeyBindings {
  nextPage: string[];
  prevPage: string[];
  toggleAuto: string[];
  openFile: string[];
  toggleSettings: string[];
  toggleToc: string[];
  fontUp: string[];
  fontDown: string[];
  /** Native fullscreen (Electron BrowserWindow) */
  toggleFullscreen: string[];
  /** Hide all chrome (toolbar, progress bar, indicators) so only text remains */
  toggleImmersive: string[];
  /** Open the highlights / notes panel */
  toggleNotes: string[];
  /** Toggle reading layout between paginated and vertical scrolling */
  cycleReadingLayout: string[];
  /** Cycle reflowable column count 1 -> 2 -> 3 */
  cycleColumnCount: string[];
  /** Toggle mouse cursor hidden state */
  toggleCursor: string[];
  /** Toggle mouse wheel paging */
  toggleWheelPaging: string[];
  /** Toggle mouse click paging */
  toggleClickPaging: string[];
  /** Toggle page flip animation */
  togglePageFlipAnimation: string[];
  /** Start, pause, or resume text-to-speech reading */
  toggleTts: string[];
  /** Create a highlight from the current text selection */
  commitSelectionHighlight: string[];
}

export interface Highlight {
  id: string;
  bookId: string;
  format: BookFormat;
  /** Format-specific start coordinate. TXT: stringified char offset. EPUB: CFI. */
  start: string;
  /** Format-specific end coordinate. TXT: stringified char offset. EPUB: CFI. */
  end: string;
  /** CSS color (rgba) used as background (highlighter ink). */
  color: string;
  /** Snippet of the highlighted text for the notes panel. */
  text: string;
  /** Optional user note text. */
  note?: string;
  /** TOC href of the chapter where this highlight was created, when available. */
  tocHref?: string;
  createdAt: number;
}

export const HIGHLIGHT_COLORS: { id: string; label: string; color: string }[] = [
  { id: 'yellow', label: '黄', color: 'rgba(255, 235, 59, 0.45)' },
  { id: 'green', label: '绿', color: 'rgba(129, 199, 132, 0.45)' },
  { id: 'blue', label: '蓝', color: 'rgba(100, 181, 246, 0.45)' },
  { id: 'pink', label: '粉', color: 'rgba(244, 143, 177, 0.45)' },
  { id: 'orange', label: '橙', color: 'rgba(255, 167, 38, 0.45)' },
  { id: 'purple', label: '紫', color: 'rgba(186, 104, 200, 0.45)' },
];

/**
 * Actions that can be bound to single/double clicks on the left/right half
 * of the text area. `none` is a no-op so users can fully disable a slot.
 */
export type ClickAction =
  | 'none'
  | 'prev'
  | 'next'
  | 'toggleCursor'
  | 'hideCursor'
  | 'showCursor'
  | 'toggleAuto'
  | 'toggleTts'
  | 'toggleImmersive'
  | 'toggleFullscreen';

export interface ClickActions {
  /** Left mouse button — left half, single click. */
  leftSingle: ClickAction;
  /** Left mouse button — right half, single click. */
  rightSingle: ClickAction;
  /** Left mouse button — left half, double click. */
  leftDouble: ClickAction;
  /** Left mouse button — right half, double click. */
  rightDouble: ClickAction;
  /**
   * Right mouse button click (single, anywhere in the reading area).
   * Note: right-button DRAG is reserved for creating TXT highlights, so this
   * only fires when the right click did not turn into a drag-selection.
   */
  rightButton: ClickAction;
  /** Middle mouse button (clicking the scroll wheel itself). */
  middleButton: ClickAction;
}

export interface WheelActions {
  /** Wheel up gesture in paginated reading modes. */
  up: ClickAction;
  /** Wheel down gesture in paginated reading modes. */
  down: ClickAction;
}

export type DragHighlightAction = 'none' | 'highlight';

export interface DragHighlightActions {
  /** Left-button drag selection in TXT. */
  leftButton: DragHighlightAction;
  /** Right-button drag selection in TXT. */
  rightButton: DragHighlightAction;
}

export interface ReaderSettings {
  fontSize: number; // px
  fontFamily: string;
  /** CSS font-weight: 100..900 (400=normal, 700=bold). Applies to TXT/EPUB/PDF-reflow. */
  fontWeight: number;
  lineHeight: number;
  pageMargin: number; // px
  /** Force N columns per page for reflowable formats (TXT/EPUB). 1=single, 2=double, 3=triple. */
  columnCount: 1 | 2 | 3;
  /** Reflowable reading layout: page turns or continuous vertical scrolling. */
  readingLayout: ReadingLayout;
  themeId: ThemeId;
  customTheme: ThemeColors;
  /** Settings panel background opacity (0.25..1). */
  settingsPanelOpacity: number;
  /** Auto-paging interval in seconds */
  autoInterval: number;
  /** Mouse wheel paging on/off */
  wheelPaging: boolean;
  /** Separate actions for mouse wheel up/down. */
  wheelActions: WheelActions;
  /** Click left/right to page */
  clickPaging: boolean;
  /**
   * Per-half single/double click actions. When a half's single and double
   * actions are equal (or the double is `none`), clicks on that half fire
   * instantly; otherwise we wait ~200ms to disambiguate.
   */
  clickActions: ClickActions;
  /** TXT drag-selection actions. */
  dragHighlightActions: DragHighlightActions;
  bindings: KeyBindings;
  /** Direction-aware page flip animation in paginated modes. */
  pageFlipAnimation: boolean;
  /** Text-to-speech rate. */
  ttsRate: number;
  /** Text-to-speech pitch. */
  ttsPitch: number;
  /** Preferred system voice URI, when available. */
  ttsVoiceURI?: string;
  /** PDF: single page or continuous scroll. Reflow is retained for old saved settings. */
  pdfMode: 'single' | 'scroll' | 'reflow';
  /** PDF page fitting mode. Custom uses pdfScale as a percentage. */
  pdfScaleMode: 'width' | 'page' | 'custom';
  /** PDF custom zoom percentage (25..500). */
  pdfScale: number;
}

export type BookSettingsMap = Record<string, ReaderSettings>;

export interface SearchResult {
  id: string;
  /** Format-specific jump target. TXT: char offset, PDF: page, Foliate: CFI. */
  location: string;
  label?: string;
  excerpt: string;
  /** 0..1 approximate progress, when the renderer can compute it cheaply. */
  percent?: number;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  nextPage: ['Space', 'ArrowRight', 'PageDown', 'KeyJ'],
  prevPage: ['ArrowLeft', 'PageUp', 'KeyK'],
  toggleAuto: ['F9'],
  openFile: ['Ctrl+KeyO'],
  toggleSettings: ['F10'],
  toggleToc: ['F4'],
  fontUp: ['Ctrl+Equal'],
  fontDown: ['Ctrl+Minus'],
  toggleFullscreen: ['F11'],
  toggleImmersive: ['F8'],
  toggleNotes: ['F2'],
  cycleReadingLayout: [],
  cycleColumnCount: [],
  toggleCursor: [],
  toggleWheelPaging: [],
  toggleClickPaging: [],
  togglePageFlipAnimation: [],
  toggleTts: ['F6'],
  commitSelectionHighlight: [],
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 22,
  fontFamily: 'system-ui, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif',
  fontWeight: 400,
  lineHeight: 1.7,
  pageMargin: 40,
  columnCount: 1,
  readingLayout: 'paginated',
  themeId: 'sepia',
  customTheme: {
    bg: '250 244 224',
    fg: '40 30 20',
    accent: '200 120 80',
    panel: '240 232 210',
    muted: '120 110 95',
  },
  settingsPanelOpacity: 1,
  autoInterval: 30,
  wheelPaging: true,
  wheelActions: {
    up: 'prev',
    down: 'next',
  },
  clickPaging: true,
  clickActions: {
    leftSingle: 'prev',
    rightSingle: 'next',
    leftDouble: 'toggleCursor',
    rightDouble: 'toggleCursor',
    rightButton: 'none',
    middleButton: 'next',
  },
  dragHighlightActions: {
    leftButton: 'highlight',
    rightButton: 'highlight',
  },
  bindings: DEFAULT_BINDINGS,
  pageFlipAnimation: true,
  ttsRate: 1,
  ttsPitch: 1,
  pdfMode: 'scroll',
  pdfScaleMode: 'width',
  pdfScale: 100,
};

export const PRESET_THEMES: Record<Exclude<ThemeId, 'custom'>, ThemeColors> = {
  white: {
    bg: '255 255 255',
    fg: '20 20 20',
    accent: '37 99 235',
    panel: '244 244 248',
    muted: '120 120 130',
  },
  sepia: {
    bg: '250 244 224',
    fg: '40 30 20',
    accent: '200 120 80',
    panel: '240 232 210',
    muted: '120 110 95',
  },
  green: {
    bg: '199 237 204',
    fg: '30 50 35',
    accent: '60 130 80',
    panel: '180 220 188',
    muted: '90 110 95',
  },
  gray: {
    bg: '60 64 70',
    fg: '220 220 220',
    accent: '170 200 240',
    panel: '50 54 60',
    muted: '160 160 165',
  },
  dark: {
    bg: '32 33 36',
    fg: '220 220 224',
    accent: '138 180 248',
    panel: '42 44 48',
    muted: '150 150 156',
  },
  black: {
    bg: '0 0 0',
    fg: '200 200 200',
    accent: '180 180 220',
    panel: '15 15 15',
    muted: '110 110 120',
  },
};
