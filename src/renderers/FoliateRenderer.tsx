import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  useMemo,
  useState,
} from 'react';
import type {
  Highlight,
  OpenedBook,
  ReaderSettings,
  SearchResult,
  ThemeColors,
} from '@shared/types';
import { PRESET_THEMES } from '@shared/types';
import { useReaderStore } from '@/store/useReaderStore';

export interface RendererHandle {
  next: () => void;
  prev: () => void;
  goTo: (loc: string) => void;
  goToPercent?: (percent: number) => void;
  getToc: () => Promise<TocItem[]>;
  search?: (query: string) => Promise<SearchResult[]>;
  goToSearchResult?: (result: SearchResult) => void;
  /** Optional: whether this renderer supports inline highlights / notes. */
  supportsHighlights?: () => boolean;
  /**
   * Optional: build a Highlight from the current window text selection.
   * Returns the new highlight (already added to the store) plus a bounding
   * rect of the selection in viewport coordinates so the caller can position
   * a popup. Returns null when the selection is empty/invalid.
   */
  commitSelectionHighlight?: (color: string) => {
    id: string;
    rect: DOMRect;
  } | null;
  /** Optional: jump the view to a saved highlight (by start coordinate). */
  goToHighlight?: (start: string) => void;
  /** Optional: return the current readable text for continuous TTS. */
  getTtsSnapshot?: () => Promise<TtsSnapshot> | TtsSnapshot;
  /** Optional fixed-layout zoom controls (currently used by PDF). */
  zoomIn?: () => void;
  zoomOut?: () => void;
  resetZoom?: () => void;
}

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface TtsSnapshot {
  text: string;
  location: string;
  hasNext: boolean;
}

interface Props {
  book: OpenedBook;
  settings: ReaderSettings;
  seekTo: string | null;
  onProgress: (loc: string, percent: number, tocHref?: string | null) => void;
  onTocReady: (toc: TocItem[]) => void;
  onError: (msg: string) => void;
  /** Whether to render `cursor: none` inside the iframe documents. */
  cursorHidden?: boolean;
  /** Color used for highlights created via natural iframe selection. */
  defaultHighlightColor?: string;
  /**
   * Called with the viewport-x of a click inside an iframe. The parent
   * decides whether it falls in the left or right half and dispatches
   * the configured single/double click action.
   */
  onIframeAreaClick?: (clientX: number) => void;
  /**
   * Called when the user clicks the middle (1) or right (2) button inside
   * an iframe document, without an accompanying drag. The parent runs the
   * corresponding `clickActions.middleButton` / `rightButton`.
   */
  onIframeButtonClick?: (button: 1 | 2) => void;
  /**
   * Called for wheel events inside iframe documents. Parent decides whether
   * that means font zoom, page turn, or natural scrolling.
   */
  onIframeWheel?: (deltaY: number, ctrlKey: boolean) => void;
  /**
   * Fired right after a new highlight has been committed (added to the
   * store + drawn on the overlay). Parent shows the color/delete popup.
   */
  onHighlightCommitted?: (id: string, rect: DOMRect) => void;
}

/**
 * Build CSS injected into each chapter iframe.
 * We need !important on text-flow elements to override the book's own
 * stylesheet (many EPUBs declare `p { font-size: 14px !important }`).
 * Headings stay proportional to the user's font size for visual hierarchy.
 */
function buildContentCss(settings: ReaderSettings, colors: ThemeColors): string {
  const size = settings.fontSize;
  const weight = settings.fontWeight ?? 400;
  const bg = `rgb(${colors.bg})`;
  const fg = `rgb(${colors.fg})`;
  const link = `rgb(${colors.accent})`;
  const forceWeight = weight !== 400;
  const weightRule = forceWeight ? `font-weight: ${weight} !important;` : '';
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html, body {
      background: ${bg} !important;
      color: ${fg} !important;
      font-family: ${settings.fontFamily};
      font-size: ${size}px !important;
      line-height: ${settings.lineHeight} !important;
      ${forceWeight ? `font-weight: ${weight} !important;` : ''}
    }
    p, li, dd, dt, blockquote, td, th, figcaption, span, div {
      font-size: ${size}px !important;
      line-height: ${settings.lineHeight} !important;
      color: ${fg};
      ${weightRule}
    }
    h1 { font-size: ${Math.round(size * 1.6)}px !important; ${forceWeight ? `font-weight: ${Math.min(900, weight + 100)} !important;` : ''} }
    h2 { font-size: ${Math.round(size * 1.4)}px !important; ${forceWeight ? `font-weight: ${Math.min(900, weight + 100)} !important;` : ''} }
    h3 { font-size: ${Math.round(size * 1.25)}px !important; ${forceWeight ? `font-weight: ${Math.min(900, weight + 100)} !important;` : ''} }
    h4, h5, h6 { font-size: ${Math.round(size * 1.1)}px !important; ${forceWeight ? `font-weight: ${Math.min(900, weight + 100)} !important;` : ''} }
    a, a:link, a:visited { color: ${link}; ${weightRule} }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap !important; font-size: ${size}px !important; ${weightRule} }
  `;
}

const FoliateRenderer = forwardRef<RendererHandle, Props>(function FoliateRenderer(
  {
    book,
    settings,
    seekTo,
    onProgress,
    onTocReady,
    onError,
    cursorHidden,
    defaultHighlightColor,
    onIframeAreaClick,
    onIframeButtonClick,
    onIframeWheel,
    onHighlightCommitted,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const lastLocationRef = useRef<string | null>(seekTo);
  const lastTocHrefRef = useRef<string | null>(null);
  const navQueueRef = useRef<Promise<void>>(Promise.resolve());
  const layoutReadyRef = useRef<Promise<void>>(Promise.resolve());
  const resolveLayoutReadyRef = useRef<(() => void) | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const preloadedSectionsRef = useRef<Map<number, 'loading' | 'ready'>>(new Map());
  /** Foliate's `Overlayer` class — lazily imported alongside view.js. */
  const overlayerCtorRef = useRef<any>(null);
  /**
   * Parse-time progress indicator. MOBI in particular can take 1-3s to
   * unpack/PalmDoc-decompress on the main thread; without feedback this
   * looks like the app froze. We clear it after `view.init` resolves.
   */
  const [parseMsg, setParseMsg] = useState<string>('');

  // Highlights for THIS book, sourced from the global store. Filtering by
  // bookId + format keeps the list tight and prevents cross-book bleed.
  const allNotes = useReaderStore((s) => s.notes);
  const addNote = useReaderStore((s) => s.addNote);
  const notes = useMemo(
    () => allNotes.filter((n) => n.bookId === book.id && IS_FOLIATE_FORMAT.has(n.format)),
    [allNotes, book.id],
  );

  /** CFIs we've drawn on overlays, with the color last passed. Used to diff
   *  against the store on every notes change so we add/remove/re-color
   *  exactly the SVG rectangles foliate's Overlayer is rendering. */
  const drawnRef = useRef<Map<string, string>>(new Map());
  /** Latest values for callbacks fired from iframe listeners (avoids re-attaching). */
  const callbacksRef = useRef({
    onIframeAreaClick,
    onIframeButtonClick,
    onIframeWheel,
    onHighlightCommitted,
    defaultHighlightColor,
  });
  callbacksRef.current = {
    onIframeAreaClick,
    onIframeButtonClick,
    onIframeWheel,
    onHighlightCommitted,
    defaultHighlightColor,
  };
  /** Live cursor-hidden value so iframes loaded later still pick it up. */
  const cursorHiddenRef = useRef(!!cursorHidden);
  cursorHiddenRef.current = !!cursorHidden;

  // Track per-doc per-iframe state via WeakSets — handy for noting which
  // documents we've already wired listeners onto (each iframe load fires
  // independently and we don't want to double-bind).
  const wiredDocsRef = useRef<WeakSet<Document>>(new WeakSet());

  // Mount + open
  useEffect(() => {
    navQueueRef.current = Promise.resolve();
    layoutReadyRef.current = Promise.resolve();
    resolveLayoutReadyRef.current = null;
    lastLocationRef.current = seekTo;
    lastTocHrefRef.current = null;
    preloadedSectionsRef.current.clear();
    let cancelled = false;
    let view: any = null;

    (async () => {
      try {
        const fmt = book.format.toUpperCase();
        setParseMsg(`正在解析 ${fmt}...`);
        await import(/* @vite-ignore */ 'foliate-js/view.js');
        const overlayerMod: any = await import(/* @vite-ignore */ 'foliate-js/overlayer.js');
        overlayerCtorRef.current = overlayerMod.Overlayer ?? overlayerMod.default?.Overlayer;
        if (cancelled || !containerRef.current) return;

        view = document.createElement('foliate-view');
        view.style.width = '100%';
        view.style.height = '100%';
        view.style.display = 'block';
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(view);
        viewRef.current = view;

        // Wire up listeners BEFORE init so we don't miss the first relocate
        view.addEventListener('relocate', (e: any) => {
          const detail = e.detail ?? {};
          const loc =
            detail?.cfi ||
            detail?.tocItem?.href ||
            String(detail?.fraction ?? 0);
          const pct = typeof detail.fraction === 'number' ? detail.fraction : 0;
          if (loc) lastLocationRef.current = loc;
          lastTocHrefRef.current = detail?.tocItem?.href ?? lastTocHrefRef.current;
          onProgress(loc, pct, detail?.tocItem?.href ?? null);
          scheduleAdjacentPreload(detail?.section?.current);
        });

        // Each new chapter / iframe gets click + selection wiring
        view.addEventListener('load', (e: any) => {
          const doc: Document | undefined = e.detail?.doc;
          if (!doc) return;
          wireDocument(doc);
        });

        // When a section's overlayer is freshly created, re-attach all our
        // tracked highlights so they redraw on this newly-loaded chapter.
        view.addEventListener('create-overlay', () => {
          for (const [cfi, color] of drawnRef.current) {
            try {
              void view.addAnnotation({ value: cfi, color });
            } catch {
              /* ignore — section may not be the one this overlay belongs to */
            }
          }
        });

        // Custom drawing: we use foliate's Overlayer.highlight (translucent
        // rectangles) with the per-annotation color the user picked.
        view.addEventListener('draw-annotation', (e: any) => {
          const { draw, annotation } = e.detail;
          const O = overlayerCtorRef.current;
          if (!O || !draw) return;
          draw(O.highlight, { color: annotation.color });
        });

        // Click on an existing highlight → open the popup at that rect.
        view.addEventListener('show-annotation', (e: any) => {
          const { value, range } = e.detail ?? {};
          if (!value) return;
          const matching = allNotesRef.current.find(
            (n) => n.start === value && n.bookId === book.id,
          );
          if (!matching) return;
          const rect = computeViewportRect(range);
          if (rect && callbacksRef.current.onHighlightCommitted) {
            callbacksRef.current.onHighlightCommitted(matching.id, rect);
          }
        });

        const file = new File(
          [book.data],
          `${book.name}.${book.format}`,
          { type: '' },
        );

        // MOBI is the slowest to parse — surface that explicitly so the user
        // doesn't think the app hung.
        if (book.format === 'mobi' || book.format === 'azw3') {
          setParseMsg(`正在解压 ${fmt}（大文件可能需 2-5 秒）...`);
        }

        await view.open(file);
        if (cancelled) return;

        applyStyles(view, settings);
        applyColumnCount(view, settings.columnCount);
        applyReadingLayout(view, settings.readingLayout);
        applyPageFlipAnimation(view, settings.pageFlipAnimation);

        try {
          const toc = view.book?.toc ?? [];
          onTocReady(flattenToc(toc));
        } catch {
          onTocReady([]);
        }

        try {
          await view.init({
            lastLocation: seekTo || undefined,
            showTextStart: !seekTo,
          });
        } catch {
          try {
            await view.renderer?.next?.();
          } catch {
            /* ignore */
          }
        }

        // After the first section loads, queue up any pre-existing highlights.
        // We seed `drawnRef` from the current notes list so the diff effect
        // below renders them on the right pages as the reader scrolls.
        for (const h of notesRef.current) {
          drawnRef.current.set(h.start, h.color);
          try {
            void view.addAnnotation({ value: h.start, color: h.color });
          } catch {
            /* ignore */
          }
        }
        setParseMsg('');
        scheduleAdjacentPreload();
      } catch (err: any) {
        console.error('Foliate open error:', err);
        onError(`无法打开此文件：${err?.message ?? err}`);
        setParseMsg('');
      }
    })();

    return () => {
      cancelled = true;
      releasePreloadedSections();
      if (viewRef.current) {
        try {
          viewRef.current.close?.();
        } catch {
          /* ignore */
        }
        viewRef.current = null;
      }
      drawnRef.current.clear();
      wiredDocsRef.current = new WeakSet();
    };
    // Re-mount whenever a different book is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onResize = () => {
      if (!resolveLayoutReadyRef.current) {
        layoutReadyRef.current = new Promise((resolve) => {
          resolveLayoutReadyRef.current = resolve;
        });
      }

      if (resizeTimerRef.current != null) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        const view = viewRef.current;
        try {
          if (view) {
            applyStyles(view, settingsRef.current);
            applyColumnCount(view, settingsRef.current.columnCount);
            applyReadingLayout(view, settingsRef.current.readingLayout);
            applyPageFlipAnimation(view, settingsRef.current.pageFlipAnimation);
            view.renderer?.render?.();
          }
        } catch (e) {
          console.warn('foliate resize render failed:', e);
        } finally {
          resolveLayoutReadyRef.current?.();
          resolveLayoutReadyRef.current = null;
          scheduleAdjacentPreload();
        }
      }, 180);
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (resizeTimerRef.current != null) window.clearTimeout(resizeTimerRef.current);
      resolveLayoutReadyRef.current?.();
      resolveLayoutReadyRef.current = null;
    };
  }, [book.id]);

  // Re-apply styles when settings change (debounced via React batching)
  useEffect(() => {
    if (viewRef.current) applyStyles(viewRef.current, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.fontSize,
    settings.fontFamily,
    settings.fontWeight,
    settings.lineHeight,
    settings.themeId,
    settings.customTheme,
  ]);

  // Re-apply column count when it changes (controls the paginator host element)
  useEffect(() => {
    if (viewRef.current) applyColumnCount(viewRef.current, settings.columnCount);
  }, [settings.columnCount]);

  useEffect(() => {
    if (viewRef.current) applyReadingLayout(viewRef.current, settings.readingLayout);
  }, [settings.readingLayout]);

  useEffect(() => {
    if (viewRef.current) applyPageFlipAnimation(viewRef.current, settings.pageFlipAnimation);
  }, [settings.pageFlipAnimation]);

  // ===== Keep highlight overlays in sync with the store =====
  // Notes ref so the open-effect can read the latest at init time.
  const notesRef = useRef<Highlight[]>(notes);
  notesRef.current = notes;
  // Track ALL notes (used by show-annotation lookup which doesn't pre-filter
  // by book — defensive, in case a stale CFI lingers).
  const allNotesRef = useRef<Highlight[]>(allNotes);
  allNotesRef.current = allNotes;

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const desired = new Map<string, string>();
    for (const h of notes) desired.set(h.start, h.color);

    // Remove highlights that vanished or whose color changed
    for (const [cfi, color] of Array.from(drawnRef.current.entries())) {
      if (!desired.has(cfi) || desired.get(cfi) !== color) {
        try {
          void view.deleteAnnotation({ value: cfi });
        } catch {
          /* ignore */
        }
        drawnRef.current.delete(cfi);
      }
    }
    // Add (or re-add with new color) anything missing
    for (const [cfi, color] of desired) {
      if (!drawnRef.current.has(cfi)) {
        try {
          void view.addAnnotation({ value: cfi, color });
        } catch {
          /* ignore */
        }
        drawnRef.current.set(cfi, color);
      }
    }
  }, [notes]);

  // ===== Cursor visibility — propagate into every iframe document =====
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    applyCursorToAllDocs(view, !!cursorHidden);
  }, [cursorHidden]);

  // Wire selection + click forwarding for a freshly loaded iframe document.
  function wireDocument(doc: Document): void {
    if (wiredDocsRef.current.has(doc)) return;
    wiredDocsRef.current.add(doc);

    // Apply current cursor state as soon as the iframe loads
    applyCursorToDoc(doc, cursorHiddenRef.current);

    // Track mousedown position so we can distinguish a click (no drag) from
    // a selection drag. Browsers normally suppress `click` after a drag, but
    // some EPUB reflows still fire one — so we belt-and-braces it.
    let downX = 0;
    let downY = 0;
    let downBtn = -1;

    doc.addEventListener(
      'mousedown',
      (ev: MouseEvent) => {
        downX = ev.clientX;
        downY = ev.clientY;
        downBtn = ev.button;
        // Block the browser's default middle-click autoscroll cursor so the
        // bound action runs cleanly.
        if (ev.button === 1) ev.preventDefault();
      },
      true,
    );

    // `auxclick` fires for non-primary buttons (middle / right) only when
    // the click did NOT turn into a drag — exactly what we want, since a
    // right-button drag is reserved for highlight selection.
    doc.addEventListener('auxclick', (ev: MouseEvent) => {
      if (ev.button !== 1 && ev.button !== 2) return;
      // If a non-collapsed selection just finished, don't steal the click.
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
      ev.preventDefault();
      callbacksRef.current.onIframeButtonClick?.(ev.button as 1 | 2);
    });

    doc.addEventListener('click', (ev: MouseEvent) => {
      // Skip if foliate already handled the event (link/anchor jumps).
      if (ev.defaultPrevented) return;
      if (ev.button !== 0) return;
      // Skip if click landed far from mousedown — likely a drag-select.
      if (Math.abs(ev.clientX - downX) > 5 || Math.abs(ev.clientY - downY) > 5) {
        return;
      }
      // Skip if there's a non-collapsed selection (user just selected text).
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;
      // Skip if the click hit an existing annotation rect; foliate's
      // Overlayer.hitTest will already have emitted `show-annotation`.
      const overlayer = findOverlayer(viewRef.current, doc);
      if (overlayer?.hitTest?.({ x: ev.clientX, y: ev.clientY })?.[0]) return;

      const cb = callbacksRef.current.onIframeAreaClick;
      if (!cb) return;
      const iframe = doc.defaultView?.frameElement as HTMLElement | null;
      const ifRect = iframe?.getBoundingClientRect();
      const viewportX = (ifRect?.left ?? 0) + ev.clientX;
      cb(viewportX);
    });

    doc.addEventListener('mouseup', (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      // Wait a tick so the selection is finalized.
      setTimeout(() => commitSelectionFromDoc(doc), 0);
    });

    doc.addEventListener(
      'wheel',
      (ev: WheelEvent) => {
        const cb = callbacksRef.current.onIframeWheel;
        if (!cb) return;
        if (ev.ctrlKey) {
          ev.preventDefault();
          cb(ev.deltaY, true);
          return;
        }
        if (viewRef.current?.renderer?.getAttribute?.('flow') === 'scrolled') {
          ev.preventDefault();
          viewRef.current?.renderer?.scrollBy?.(ev.deltaX, ev.deltaY);
          return;
        }
        ev.preventDefault();
        cb(ev.deltaY, false);
      },
      { passive: false },
    );

    // Suppress the system context menu inside the reading area so it
    // doesn't get in the way of the highlight popup.
    doc.addEventListener('contextmenu', (ev) => ev.preventDefault());

    // Forgo paging on right-click; we just keep selection working.
    void downBtn;
  }

  function commitSelectionFromDoc(doc: Document): { id: string; rect: DOMRect | null } | null {
    const view = viewRef.current;
    if (!view) return null;
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return null;

    // Find which section this doc belongs to (foliate paginator may have
    // multiple sections preloaded in some renderers).
    const contents: Array<{ index: number; doc: Document }> = view.renderer?.getContents?.() ?? [];
    const c = contents.find((x) => x.doc === doc) ?? contents[0];
    if (!c) return null;

    let cfi: string;
    try {
      cfi = view.getCFI(c.index, range);
    } catch (err) {
      console.warn('getCFI failed:', err);
      return null;
    }
    if (!cfi) return null;

    // De-dupe: if we already have a highlight at this exact CFI, skip.
    if (drawnRef.current.has(cfi)) {
      sel.removeAllRanges();
      return null;
    }

    const color = callbacksRef.current.defaultHighlightColor || 'rgba(255, 235, 59, 0.45)';
    const id = 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const highlight: Highlight = {
      id,
      bookId: book.id,
      format: book.format,
      start: cfi,
      end: cfi,
      color,
      text: text.slice(0, 200),
      tocHref: lastTocHrefRef.current ?? undefined,
      createdAt: Date.now(),
    };

    // Compute the range's rect in the parent viewport BEFORE clearing selection
    const rect = computeViewportRect(range);

    // Persist + draw immediately
    addNote(highlight);
    drawnRef.current.set(cfi, color);
    try {
      void view.addAnnotation({ value: cfi, color });
    } catch {
      /* ignore */
    }
    sel.removeAllRanges();

    if (rect && callbacksRef.current.onHighlightCommitted) {
      callbacksRef.current.onHighlightCommitted(id, rect);
    }
    return { id, rect };
  }

  function queueNavigation(run: (view: any) => Promise<unknown> | unknown): void {
    navQueueRef.current = navQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await layoutReadyRef.current;
        const view = viewRef.current;
        if (!view) return;
        try {
          await withTimeout(Promise.resolve(run(view)), 3500);
        } catch (e) {
          console.warn('foliate navigation stalled; forcing a relayout:', e);
          try {
            view.renderer?.render?.();
          } catch {
            /* ignore */
          }
        } finally {
          scheduleAdjacentPreload();
        }
      });
  }

  function scheduleAdjacentPreload(centerIndex?: number): void {
    const view = viewRef.current;
    const sections = view?.book?.sections;
    if (!view || !Array.isArray(sections) || sections.length === 0) return;

    const contents = view.renderer?.getContents?.() ?? [];
    const fallbackIndex = contents.find((c: any) => Number.isFinite(c?.index))?.index;
    const index = Number.isFinite(centerIndex) ? centerIndex : fallbackIndex;
    if (!Number.isFinite(index)) return;

    const keep = new Set<number>();
    for (const delta of [-3, -2, -1, 1, 2, 3, 4, 5, 6]) {
      const i = index + delta;
      const section = sections[i];
      if (section && section.linear !== 'no') keep.add(i);
    }

    releasePreloadedSections(keep);
    for (const i of keep) {
      if (preloadedSectionsRef.current.has(i)) continue;
      preloadedSectionsRef.current.set(i, 'loading');
      const run = () => {
        Promise.resolve(sections[i]?.load?.())
          .then(() => {
            if (preloadedSectionsRef.current.has(i)) {
              preloadedSectionsRef.current.set(i, 'ready');
            } else {
              try {
                sections[i]?.unload?.();
              } catch {
                /* ignore */
              }
            }
          })
          .catch((e) => {
            preloadedSectionsRef.current.delete(i);
            console.warn(`preload section ${i} failed:`, e);
          });
      };
      if (Math.abs(i - index) <= 3) window.setTimeout(run, 0);
      else scheduleIdleTask(run);
    }
  }

  function releasePreloadedSections(keep: Set<number> = new Set()): void {
    const view = viewRef.current;
    const sections = view?.book?.sections;
    for (const [i, state] of Array.from(preloadedSectionsRef.current.entries())) {
      if (keep.has(i)) continue;
      preloadedSectionsRef.current.delete(i);
      if (state === 'ready') {
        try {
          sections?.[i]?.unload?.();
        } catch {
          /* ignore */
        }
      }
    }
  }

  useImperativeHandle(ref, () => ({
    next: () => queueNavigation((view) => view.next?.()),
    prev: () => queueNavigation((view) => view.prev?.()),
    goTo: (loc: string) => queueNavigation((view) => view.goTo?.(loc)),
    goToPercent: (percent: number) => {
      const p = Math.max(0, Math.min(1, percent));
      queueNavigation((view) => view.goToFraction?.(p));
    },
    getToc: async () => {
      const toc = viewRef.current?.book?.toc ?? [];
      return flattenToc(toc);
    },
    search: async (query: string) => {
      const view = viewRef.current;
      const q = query.trim();
      if (!view || !q) {
        view?.clearSearch?.();
        return [];
      }
      const results: SearchResult[] = [];
      let groupLabel = '';
      for await (const item of view.search({
        query: q,
        matchCase: false,
        matchDiacritics: false,
        matchWholeWords: false,
      })) {
        if (item === 'done') break;
        if (item?.progress != null) continue;
        if (item?.label) groupLabel = item.label;
        const subitems = item?.subitems ?? (item?.cfi ? [item] : []);
        for (const sub of subitems) {
          if (!sub?.cfi) continue;
          results.push({
            id: `foliate-${results.length}`,
            location: sub.cfi,
            label: groupLabel,
            excerpt: formatFoliateExcerpt(sub.excerpt),
          });
          if (results.length >= 200) return results;
        }
      }
      return results;
    },
    goToSearchResult: (result: SearchResult) => {
      queueNavigation((view) => view.select?.(result.location));
    },
    supportsHighlights: () => true,
    commitSelectionHighlight: () => {
      // Try to find an active selection in any loaded iframe doc.
      const view = viewRef.current;
      if (!view) return null;
      const contents: Array<{ doc: Document }> = view.renderer?.getContents?.() ?? [];
      for (const c of contents) {
        const sel = c.doc.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          // Snapshot id / rect by running the same commit path
          const before = drawnRef.current.size;
          const committed = commitSelectionFromDoc(c.doc);
          // If we added one, the latest entry of drawnRef has it; lookup id
          if (drawnRef.current.size > before) {
            // Latest highlight from store
            const latest = useReaderStore.getState().notes.slice(-1)[0];
            if (latest && committed?.rect) {
              return { id: latest.id, rect: committed.rect };
            }
          }
        }
      }
      return null;
    },
    goToHighlight: (start: string) => {
      queueNavigation((view) => view.goTo?.(start));
    },
    getTtsSnapshot: () => {
      const view = viewRef.current;
      if (!view) return { text: '', location: 'foliate:unready', hasNext: false };
      const contents: Array<{ index?: number; doc: Document }> =
        view.renderer?.getContents?.() ?? [];
      const visible = contents.filter((c) => isDocVisible(c.doc));
      const active = visible.length ? visible : contents.slice(0, 1);
      const text = active
        .map((c) => c.doc.body?.innerText ?? c.doc.body?.textContent ?? '')
        .join('\n\n');
      const index = active
        .map((c) => c.index)
        .filter((n): n is number => Number.isFinite(n))
        .join(',');
      return {
        text,
        location: `foliate:${lastLocationRef.current ?? index ?? 'unknown'}`,
        hasNext: true,
      };
    },
  }));

  return (
    <div className="w-full h-full relative">
      <div
        ref={containerRef}
        className="reader-content w-full h-full"
        style={{
          padding: `${settings.pageMargin}px`,
          boxSizing: 'border-box',
        }}
      />
      {parseMsg && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-panel/90 text-fg text-xs shadow z-10 pointer-events-none">
          {parseMsg}
        </div>
      )}
    </div>
  );
});

/** Formats handled by foliate-js (i.e. rendered inside iframes). */
const IS_FOLIATE_FORMAT = new Set(['epub', 'mobi', 'azw3', 'fb2']);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      },
    );
  });
}

function scheduleIdleTask(cb: () => void): void {
  const ric = (window as any).requestIdleCallback as
    | ((callback: () => void, opts?: { timeout: number }) => number)
    | undefined;
  if (typeof ric === 'function') ric(cb, { timeout: 800 });
  else window.setTimeout(cb, 0);
}

function applyStyles(view: any, settings: ReaderSettings): void {
  if (!view?.renderer) return;
  const colors =
    settings.themeId === 'custom'
      ? settings.customTheme
      : PRESET_THEMES[settings.themeId as Exclude<typeof settings.themeId, 'custom'>];
  const css = buildContentCss(settings, colors);
  try {
    view.renderer.setStyles(css);
  } catch (e) {
    console.warn('setStyles failed:', e);
  }
}

function applyColumnCount(view: any, columnCount: number): void {
  const renderer = view?.renderer;
  if (!renderer || typeof renderer.setAttribute !== 'function') return;
  try {
    const n = Math.max(1, Math.min(3, Math.round(columnCount || 1)));
    renderer.setAttribute('max-column-count', String(n));
    renderer.setAttribute('max-inline-size', n === 1 ? '720' : '1');
  } catch (e) {
    console.warn('applyColumnCount failed:', e);
  }
}

function applyReadingLayout(view: any, layout: ReaderSettings['readingLayout']): void {
  const renderer = view?.renderer;
  if (!renderer || typeof renderer.setAttribute !== 'function') return;
  try {
    renderer.setAttribute('flow', layout === 'vertical' ? 'scrolled' : 'paginated');
  } catch (e) {
    console.warn('applyReadingLayout failed:', e);
  }
}

function applyPageFlipAnimation(view: any, enabled: boolean): void {
  const renderer = view?.renderer;
  if (!renderer || typeof renderer.setAttribute !== 'function') return;
  try {
    if (enabled) renderer.setAttribute('animated', '');
    else renderer.removeAttribute?.('animated');
  } catch (e) {
    console.warn('applyPageFlipAnimation failed:', e);
  }
}

/** Apply or clear `cursor: none` on a single iframe document. */
function applyCursorToDoc(doc: Document, hidden: boolean): void {
  try {
    const root = doc.documentElement as HTMLElement;
    if (hidden) root.style.setProperty('cursor', 'none', 'important');
    else root.style.removeProperty('cursor');
    // Also flag with a CSS class so books overriding html cursor in their
    // stylesheets still get the visual change on body / *.
    if (hidden) doc.body?.setAttribute('data-cursor-hidden', 'true');
    else doc.body?.removeAttribute('data-cursor-hidden');

    // Inject a style tag that forces cursor: none on every element when the
    // attribute is present. Idempotent — only insert once per doc.
    const STYLE_ID = '__reader_cursor_style__';
    if (!doc.getElementById(STYLE_ID)) {
      const s = doc.createElement('style');
      s.id = STYLE_ID;
      s.textContent =
        'body[data-cursor-hidden="true"], body[data-cursor-hidden="true"] *' +
        ' { cursor: none !important; }';
      doc.head?.appendChild(s);
    }
  } catch {
    /* ignore — doc may be detaching */
  }
}

function applyCursorToAllDocs(view: any, hidden: boolean): void {
  try {
    const contents: Array<{ doc: Document }> = view.renderer?.getContents?.() ?? [];
    for (const c of contents) applyCursorToDoc(c.doc, hidden);
  } catch {
    /* ignore */
  }
}

function findOverlayer(view: any, doc: Document): any | null {
  try {
    const contents: Array<{ doc: Document; overlayer?: any }> =
      view?.renderer?.getContents?.() ?? [];
    return contents.find((x) => x.doc === doc)?.overlayer ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert a Range that lives inside an iframe document to a viewport-
 * relative DOMRect (i.e. expressed in the OUTER window's coordinate system).
 */
function computeViewportRect(range: Range | undefined | null): DOMRect | null {
  if (!range) return null;
  try {
    const rangeRect = range.getBoundingClientRect();
    const doc = range.startContainer.ownerDocument;
    if (!doc) return rangeRect;
    const iframe = doc.defaultView?.frameElement as HTMLElement | null;
    const ifRect = iframe?.getBoundingClientRect();
    if (!ifRect) return rangeRect;
    return new DOMRect(
      ifRect.left + rangeRect.left,
      ifRect.top + rangeRect.top,
      rangeRect.width,
      rangeRect.height,
    );
  } catch {
    return null;
  }
}

function isDocVisible(doc: Document): boolean {
  try {
    const iframe = doc.defaultView?.frameElement as HTMLElement | null;
    const rect = iframe?.getBoundingClientRect();
    if (!rect) return false;
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  } catch {
    return false;
  }
}

function flattenToc(toc: any[], depth = 0): TocItem[] {
  if (!Array.isArray(toc)) return [];
  return toc.map((t) => ({
    label: t.label?.trim?.() ?? String(t.label ?? ''),
    href: t.href ?? '',
    subitems: flattenToc(t.subitems ?? [], depth + 1),
  }));
}

function formatFoliateExcerpt(excerpt: any): string {
  if (!excerpt) return '';
  if (typeof excerpt === 'string') return excerpt.replace(/\s+/g, ' ').trim();
  const pre = excerpt.pre ?? '';
  const match = excerpt.match ?? '';
  const post = excerpt.post ?? '';
  return `${pre}${match}${post}`.replace(/\s+/g, ' ').trim();
}

export default FoliateRenderer;
