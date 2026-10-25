import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReaderStore } from '@/store/useReaderStore';
import FoliateRenderer, { type RendererHandle, type TocItem } from '@/renderers/FoliateRenderer';
import PdfRenderer from '@/renderers/PdfRenderer';
import TxtRenderer from '@/renderers/TxtRenderer';
import Toolbar from './Toolbar';
import ProgressBar from './ProgressBar';
import SettingsPanel from './SettingsPanel';
import TocPanel from './TocPanel';
import RecentPanel from './RecentPanel';
import NotesPanel from './NotesPanel';
import HomeView from './HomeView';
import SearchPanel from './SearchPanel';
import { useKeyBindings } from '@/hooks/useKeyBindings';
import { useAutoPaging } from '@/hooks/useAutoPaging';
import { useSpeechReader } from '@/hooks/useSpeechReader';
import { HIGHLIGHT_COLORS, type ClickAction, type ClickActions } from '@shared/types';

/** ms window for double-click discrimination (only used when single ≠ double). */
const DOUBLE_CLICK_DELAY = 220;

export default function ReaderView() {
  const {
    book,
    settings,
    seekTo,
    pageNonce,
    pageDirection,
    selectionHighlightNonce,
    updateProgress,
    setError,
    setSettings,
    autoOn,
    toggleAuto,
    error,
    loading,
    view,
    immersive,
    toggleImmersive,
    fullscreen,
    toggleFullscreen,
    cursorHidden,
    setCursorHidden,
    toggleCursorHidden,
    ttsToggleNonce,
    removeNote,
    updateNote,
  } = useReaderStore();

  const rendererRef = useRef<RendererHandle>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const wheelLockRef = useRef<number>(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** Last color the user picked, persisted across selections within one session. */
  const [lastColor, setLastColor] = useState<string>(HIGHLIGHT_COLORS[0].color);
  /** Floating popup shown right after creating a highlight. */
  const [hlPopup, setHlPopup] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const hlPopupRef = useRef<typeof hlPopup>(null);
  const [pageTurn, setPageTurn] = useState<'next' | 'prev' | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const suppressNextClickRef = useRef(false);
  hlPopupRef.current = hlPopup;

  useKeyBindings({
    zoomIn: () => rendererRef.current?.zoomIn?.(),
    zoomOut: () => rendererRef.current?.zoomOut?.(),
  });
  useAutoPaging();

  useEffect(() => {
    setShowSearch(false);
  }, [book?.id]);

  useEffect(() => {
    function isTextInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (isTextInput(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, []);

  // Mirror cursor-hidden flag onto <body> so the entire app gets `cursor: none`.
  // EPUB iframes are propagated separately by FoliateRenderer.
  useEffect(() => {
    const cls = 'cursor-hidden';
    if (cursorHidden) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [cursorHidden]);

  const shouldAnimatePageTurn = useCallback(
    (dir: 'next' | 'prev') => {
      void dir;
      if (!settingsRef.current.pageFlipAnimation || !book) return false;
      if (book.format === 'txt') return settingsRef.current.readingLayout === 'paginated';
      if (book.format === 'pdf') return settingsRef.current.pdfMode === 'single';
      return false;
    },
    [book],
  );

  const turnPage = useCallback(
    (dir: 'next' | 'prev') => {
      if (shouldAnimatePageTurn(dir)) {
        setPageTurn(null);
        requestAnimationFrame(() => {
          setPageTurn(dir);
          window.setTimeout(() => setPageTurn(null), 260);
        });
      }
      if (dir === 'next') rendererRef.current?.next();
      else rendererRef.current?.prev();
    },
    [shouldAnimatePageTurn],
  );

  const tts = useSpeechReader({
    rendererRef,
    settings,
    bookId: book?.id,
    turnPage,
  });
  const lastTtsToggleNonceRef = useRef(0);

  useEffect(() => {
    if (!ttsToggleNonce || ttsToggleNonce === lastTtsToggleNonceRef.current) return;
    lastTtsToggleNonceRef.current = ttsToggleNonce;
    tts.toggle();
  }, [ttsToggleNonce, tts.toggle]);

  // Bridge external page triggers (keyboard, auto, click, wheel) to the renderer
  useEffect(() => {
    if (!pageDirection) return;
    turnPage(pageDirection);
  }, [pageNonce, pageDirection, turnPage]);

  // Auto-close highlight popup when navigating
  useEffect(() => {
    setHlPopup(null);
  }, [pageNonce]);

  // ===== Click action dispatcher (left/right half × single/double) =====
  // We keep one stable callback; latest settings/refs are read via refs so
  // we don't have to re-attach iframe listeners every time settings change.
  const clickStateRef = useRef<{
    timer: number | null;
    half: 'left' | 'right' | null;
  }>({ timer: null, half: null });
  const cursorActionsRef = useRef({
    toggleCursorHidden,
    setCursorHidden,
  });
  cursorActionsRef.current = { toggleCursorHidden, setCursorHidden };

  const runAction = useCallback((action: ClickAction) => {
    switch (action) {
      case 'prev':
        turnPage('prev');
        break;
      case 'next':
        turnPage('next');
        break;
      case 'toggleCursor':
        cursorActionsRef.current.toggleCursorHidden();
        break;
      case 'hideCursor':
        cursorActionsRef.current.setCursorHidden(true);
        break;
      case 'showCursor':
        cursorActionsRef.current.setCursorHidden(false);
        break;
      case 'toggleAuto':
        toggleAuto();
        break;
      case 'toggleTts':
        tts.toggle();
        break;
      case 'toggleImmersive':
        toggleImmersive();
        break;
      case 'toggleFullscreen':
        void toggleFullscreen();
        break;
      case 'none':
      default:
        break;
    }
  }, [toggleAuto, toggleFullscreen, toggleImmersive, tts.toggle, turnPage]);

  /**
   * Dispatch a click on `half` to the configured action, with double-click
   * discrimination. When the half's single == double (or double == 'none'),
   * we fire instantly to preserve the snappy paging feel.
   */
  const handleHalfClick = useCallback(
    (half: 'left' | 'right') => {
      const acts = settingsRef.current.clickActions;
      const single = half === 'left' ? acts.leftSingle : acts.rightSingle;
      const dbl = half === 'left' ? acts.leftDouble : acts.rightDouble;
      const needsDelay = dbl !== 'none' && dbl !== single;

      if (!needsDelay) {
        runAction(single);
        return;
      }

      const st = clickStateRef.current;
      if (st.timer != null && st.half === half) {
        // Double-click confirmed
        window.clearTimeout(st.timer);
        st.timer = null;
        st.half = null;
        runAction(dbl);
        return;
      }
      // First click of a potential double — defer
      if (st.timer != null) {
        // Pending click on the OTHER half: flush it immediately as a single
        window.clearTimeout(st.timer);
        const prevHalf = st.half;
        st.timer = null;
        st.half = null;
        if (prevHalf) {
          const prevActs = settingsRef.current.clickActions;
          runAction(prevHalf === 'left' ? prevActs.leftSingle : prevActs.rightSingle);
        }
      }
      st.half = half;
      st.timer = window.setTimeout(() => {
        st.timer = null;
        st.half = null;
        runAction(single);
      }, DOUBLE_CLICK_DELAY);
    },
    [runAction],
  );

  /** Clean up any pending click timer when the book changes. */
  useEffect(() => {
    return () => {
      const st = clickStateRef.current;
      if (st.timer != null) {
        window.clearTimeout(st.timer);
        st.timer = null;
        st.half = null;
      }
    };
  }, [book?.id]);

  /**
   * Convert a viewport-x coordinate to 'left' | 'right' relative to the
   * reading area. Used by both the React overlay (TXT/PDF) and the iframe
   * click forwarder (EPUB).
   */
  const halfFromClientX = useCallback((clientX: number): 'left' | 'right' => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return 'left';
    return clientX - rect.left < rect.width / 2 ? 'left' : 'right';
  }, []);

  // Mouse click paging (left half / right half)
  function onAreaClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!settings.clickPaging) return;
    if (e.button !== 0) return;
    if (hlPopupRef.current) {
      setHlPopup(null);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handleHalfClick(halfFromClientX(e.clientX));
  }

  // `auxclick` fires for non-primary buttons (middle, right). The browser
  // only delivers it on a click WITHOUT drag, so a right-button drag-select
  // (TXT highlight gesture) won't trip this.
  function onAreaAuxClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!settings.clickPaging) return;
    if (hlPopupRef.current) {
      setHlPopup(null);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const acts = settings.clickActions;
    if (e.button === 1) {
      e.preventDefault();
      runAction(acts.middleButton);
    } else if (e.button === 2) {
      // If the user has an active selection (e.g. just finished a drag),
      // don't steal the click — they may want to keep the selection.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      e.preventDefault();
      runAction(acts.rightButton);
    }
  }

  // Block the browser's default middle-click autoscroll cursor — otherwise
  // pressing the wheel button shows a 4-arrow autoscroll indicator instead
  // of firing our action.
  function onAreaMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button === 1) e.preventDefault();
  }

  // Mouse wheel paging
  function onWheel(e: React.WheelEvent) {
    if (hlPopupRef.current) setHlPopup(null);
    if (!settings.wheelPaging) return;
    if (book?.format === 'pdf' && settings.pdfMode !== 'single') return;
    if (book?.format !== 'pdf' && settings.readingLayout === 'vertical') return;
    const now = Date.now();
    if (now - wheelLockRef.current < 250) return;
    if (Math.abs(e.deltaY) < 8) return;
    wheelLockRef.current = now;
    e.preventDefault();
    const action = e.deltaY > 0 ? settings.wheelActions.down : settings.wheelActions.up;
    runAction(action);
  }

  // Ctrl+Wheel changes font size
  useEffect(() => {
    function onWheelGlobal(e: WheelEvent) {
      if (!e.ctrlKey) return;
      if (book?.format === 'pdf') return;
      e.preventDefault();
      const step = e.deltaY > 0 ? -2 : 2;
      setSettings({ fontSize: Math.max(8, settings.fontSize + step) });
    }
    window.addEventListener('wheel', onWheelGlobal, { passive: false });
    return () => window.removeEventListener('wheel', onWheelGlobal);
  }, [book?.format, settings.fontSize, setSettings]);

  const commitActiveSelectionHighlight = useCallback(
    (fallbackX?: number, fallbackY?: number) => {
      const result = rendererRef.current?.commitSelectionHighlight?.(lastColor);
      if (!result) return false;
      const rect = result.rect;
      const hasRect = rect.width > 0 || rect.height > 0 || rect.left > 0 || rect.top > 0;
      if (hasRect) {
        const x = Math.max(8, rect.left + rect.width / 2);
        const y = Math.max(40, rect.bottom + 6);
        setHlPopup({ id: result.id, x, y });
      } else if (fallbackX != null && fallbackY != null) {
        setHlPopup({ id: result.id, x: Math.max(8, fallbackX), y: Math.max(40, fallbackY) });
      }
      return true;
    },
    [lastColor],
  );

  useEffect(() => {
    if (!selectionHighlightNonce) return;
    commitActiveSelectionHighlight();
  }, [selectionHighlightNonce, commitActiveSelectionHighlight]);

  // ===== Configurable drag to highlight (TXT only) =====
  // Iframe-based formats (EPUB/MOBI/AZW3/FB2) handle highlights via natural
  // selection inside the iframe — wired by FoliateRenderer.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!book || book.format !== 'txt') return;

    let startRange: Range | null = null;
    let activeButton: 0 | 2 | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;

    function caretAt(x: number, y: number): Range | null {
      const ov = overlayRef.current;
      if (!ov) return null;
      const prev = ov.style.pointerEvents;
      ov.style.pointerEvents = 'none';
      const r = (document as any).caretRangeFromPoint?.(x, y) as Range | null;
      ov.style.pointerEvents = prev || 'auto';
      return r ?? null;
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0 && e.button !== 2) return;
      const action =
        e.button === 0
          ? settingsRef.current.dragHighlightActions.leftButton
          : settingsRef.current.dragHighlightActions.rightButton;
      if (action !== 'highlight') return;
      const r = caretAt(e.clientX, e.clientY);
      if (!r) return;
      startRange = r;
      activeButton = e.button;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp, { once: true });
    }

    function onMouseMove(e: MouseEvent) {
      if (activeButton == null || !startRange) return;
      if (!dragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) < 4) return;
        dragging = true;
        if (activeButton === 0) suppressNextClickRef.current = true;
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          const collapsed = startRange.cloneRange();
          collapsed.collapse(true);
          sel.addRange(collapsed);
        }
      }
      e.preventDefault();
      const cur = caretAt(e.clientX, e.clientY);
      if (!cur) return;
      const sel = window.getSelection();
      if (!sel) return;
      try {
        sel.setBaseAndExtent(
          startRange.startContainer,
          startRange.startOffset,
          cur.startContainer,
          cur.startOffset,
        );
      } catch {
        /* ranges may be in disjoint nodes during fast drag — ignore */
      }
    }

    function onMouseUp(e: MouseEvent) {
      window.removeEventListener('mousemove', onMouseMove);
      const wasDragging = dragging;
      dragging = false;
      activeButton = null;
      startRange = null;
      if (!wasDragging) return;
      e.preventDefault();
      suppressNextClickRef.current = true;
      requestAnimationFrame(() => commitActiveSelectionHighlight(e.clientX, e.clientY + 6));
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('contextmenu', onContextMenu);
    return () => {
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [book, commitActiveSelectionHighlight]);

  // Close highlight popup on outside click / Esc / wheel / app blur.
  useEffect(() => {
    if (!hlPopup) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-hl-popup]')) return;
      suppressNextClickRef.current = true;
      setHlPopup(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setHlPopup(null);
    }
    function onWheelOrBlur() {
      setHlPopup(null);
    }
    window.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheelOrBlur, { passive: true });
    window.addEventListener('blur', onWheelOrBlur);
    return () => {
      window.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheelOrBlur);
      window.removeEventListener('blur', onWheelOrBlur);
    };
  }, [hlPopup]);

  // Callback FoliateRenderer uses to surface highlight commits and to
  // request paging actions from inside iframe documents.
  const onIframeAreaClick = useCallback(
    (clientX: number) => {
      if (hlPopupRef.current) {
        setHlPopup(null);
        return;
      }
      if (!settingsRef.current.clickPaging) return;
      handleHalfClick(halfFromClientX(clientX));
    },
    [handleHalfClick, halfFromClientX],
  );

  // Right (button=2) and middle (button=1) clicks inside iframes flow through
  // here. Both buttons map to a single configurable action — half doesn't
  // matter since the user wired one global response per button.
  const onIframeButtonClick = useCallback(
    (button: 1 | 2) => {
      if (hlPopupRef.current) {
        setHlPopup(null);
        return;
      }
      if (!settingsRef.current.clickPaging) return;
      const acts = settingsRef.current.clickActions;
      runAction(button === 1 ? acts.middleButton : acts.rightButton);
    },
    [runAction],
  );

  const onIframeWheel = useCallback(
    (deltaY: number, ctrlKey: boolean) => {
      if (hlPopupRef.current) setHlPopup(null);
      if (ctrlKey) {
        const step = deltaY > 0 ? -2 : 2;
        const fontSize = Math.max(8, settingsRef.current.fontSize + step);
        setSettings({ fontSize });
        return;
      }
      if (!settingsRef.current.wheelPaging) return;
      if (settingsRef.current.readingLayout === 'vertical') return;
      const now = Date.now();
      if (now - wheelLockRef.current < 250) return;
      if (Math.abs(deltaY) < 8) return;
      wheelLockRef.current = now;
      const action =
        deltaY > 0
          ? settingsRef.current.wheelActions.down
          : settingsRef.current.wheelActions.up;
      runAction(action);
    },
    [runAction, setSettings],
  );

  const onHighlightCommitted = useCallback(
    (id: string, rect: DOMRect) => {
      const x = Math.max(8, rect.left + rect.width / 2);
      const y = Math.max(40, rect.bottom + 6);
      setHlPopup({ id, x, y });
    },
    [],
  );

  if (view === 'home' || !book) {
    return <HomeView />;
  }

  // TXT needs a transparent interaction layer for configurable click paging.
  // PDF and iframe formats bind the same actions directly to their content.
  const showOverlay = settings.clickPaging && book.format === 'txt';

  return (
    <div className="w-full h-full flex flex-col bg-bg text-fg relative">
      {!immersive && (
        <Toolbar
          onSearch={() => setShowSearch((v) => !v)}
          ttsStatus={tts.status}
          ttsMessage={tts.message}
          onToggleTts={tts.toggle}
          onStopTts={tts.stop}
          onZoomIn={() => rendererRef.current?.zoomIn?.()}
          onZoomOut={() => rendererRef.current?.zoomOut?.()}
          onResetZoom={() => rendererRef.current?.resetZoom?.()}
        />
      )}
      <div ref={areaRef} className="flex-1 relative overflow-hidden" onWheel={onWheel}>
        {/* Renderer (sits behind the overlay) */}
        <div
          className={`absolute inset-0 ${
            pageTurn === 'next'
              ? 'reader-page-turn-next'
              : pageTurn === 'prev'
                ? 'reader-page-turn-prev'
                : ''
          }`}
        >
          {book.format === 'pdf' ? (
            <PdfRenderer
              ref={rendererRef}
              book={book}
              settings={settings}
              seekTo={seekTo}
              onProgress={updateProgress}
              onTocReady={setToc}
              onError={setError}
              onPdfScaleChange={(mode, scale) =>
                setSettings({
                  pdfScaleMode: mode,
                  ...(scale == null ? {} : { pdfScale: scale }),
                })
              }
              onAreaClick={settings.clickPaging ? onIframeAreaClick : undefined}
              onButtonClick={settings.clickPaging ? onIframeButtonClick : undefined}
            />
          ) : book.format === 'txt' ? (
            <TxtRenderer
              ref={rendererRef}
              book={book}
              settings={settings}
              seekTo={seekTo}
              onProgress={updateProgress}
              onTocReady={setToc}
              onError={setError}
            />
          ) : (
            <FoliateRenderer
              ref={rendererRef}
              book={book}
              settings={settings}
              seekTo={seekTo}
              onProgress={updateProgress}
              onTocReady={setToc}
              onError={setError}
              cursorHidden={cursorHidden}
              defaultHighlightColor={lastColor}
              onIframeAreaClick={onIframeAreaClick}
              onIframeButtonClick={onIframeButtonClick}
              onIframeWheel={onIframeWheel}
              onHighlightCommitted={onHighlightCommitted}
            />
          )}
        </div>
        {/* TXT click-paging overlay. Also handles right-click drag highlights. */}
        {showOverlay && (
          <div
            ref={overlayRef}
            className="absolute inset-0 grid grid-cols-2 z-10"
            onClick={onAreaClick}
            onAuxClick={onAreaAuxClick}
            onMouseDown={onAreaMouseDown}
            onContextMenu={(e) => e.preventDefault()}
            style={{ pointerEvents: 'auto', background: 'transparent' }}
          >
            <div className="border-r border-transparent" />
            <div className="border-l border-transparent" />
          </div>
        )}
        {/* Highlight popup: change color or delete */}
        {hlPopup && (
          <div
            data-hl-popup
            className="fixed z-50 bg-panel rounded-lg shadow-2xl border border-muted/30 px-2 py-1.5 flex items-center gap-1"
            style={{
              left: Math.min(window.innerWidth - 240, hlPopup.x),
              top: Math.min(window.innerHeight - 60, hlPopup.y),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                onClick={() => {
                  updateNote(hlPopup.id, { color: c.color });
                  setLastColor(c.color);
                }}
                className="w-6 h-6 rounded border border-black/10 hover:scale-110 transition-transform"
                style={{ background: c.color }}
              />
            ))}
            <div className="w-px h-5 bg-muted/30 mx-1" />
            <button
              onClick={() => {
                removeNote(hlPopup.id);
                setHlPopup(null);
              }}
              className="px-2 h-6 text-xs rounded hover:bg-red-500/20 text-red-500"
              title="删除此高亮"
            >
              删除
            </button>
            <button
              onClick={() => setHlPopup(null)}
              className="w-6 h-6 text-muted hover:text-fg"
              title="关闭"
            >
              ✕
            </button>
          </div>
        )}
        {/* Status / error overlay */}
        {(loading || error) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-panel/95 text-fg px-6 py-4 rounded-lg shadow-lg pointer-events-auto">
              {loading && '正在加载...'}
              {error && (
                <div className="text-red-400 max-w-md">
                  <div className="font-bold mb-2">出错了</div>
                  <div className="text-sm">{error}</div>
                  <button
                    className="mt-3 px-3 py-1 bg-accent text-bg rounded"
                    onClick={() => setError(null)}
                  >
                    关闭
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Auto-paging indicator (hidden in immersive to truly maximize text) */}
        {autoOn && !immersive && (
          <div className="absolute top-2 right-2 z-30 px-3 py-1 rounded-full text-xs bg-accent/90 text-bg shadow">
            自动翻页中（{settings.autoInterval}s）· F9 停止
          </div>
        )}
        {/* Cursor-hidden indicator (only shown in non-immersive mode and only briefly?). */}
        {cursorHidden && !immersive && (
          <div className="absolute top-2 left-2 z-30 px-2 py-0.5 rounded text-[10px] text-muted bg-panel/80 shadow pointer-events-none select-none">
            鼠标已隐藏
          </div>
        )}
        {/* Immersive mode: tiny floating exit button (top-right corner) */}
        {immersive && (
          <div className="absolute top-1 right-1 z-40 flex gap-1 opacity-30 hover:opacity-100 transition-opacity">
            <button
              onClick={() => toggleImmersive()}
              title="退出沉浸 (F8)"
              className="w-7 h-7 rounded bg-panel/80 hover:bg-panel text-xs"
            >
              ✕
            </button>
            <button
              onClick={() => void toggleFullscreen()}
              title={fullscreen ? '退出全屏 (F11)' : '全屏 (F11)'}
              className="w-7 h-7 rounded bg-panel/80 hover:bg-panel text-xs"
            >
              {fullscreen ? '⊠' : '⛶'}
            </button>
          </div>
        )}
      </div>
      {showSearch && !immersive && (
        <SearchPanel renderer={rendererRef} onClose={() => setShowSearch(false)} />
      )}
      {!immersive && (
        <ProgressBar
          onSeek={(percent) => rendererRef.current?.goToPercent?.(percent)}
        />
      )}
      <SettingsPanel />
      <TocPanel toc={toc} onJump={(href) => rendererRef.current?.goTo(href)} />
      <RecentPanel />
      <NotesPanel
        onJump={(h) => {
          if (rendererRef.current?.goToHighlight) {
            rendererRef.current.goToHighlight(h.start);
          } else {
            rendererRef.current?.goTo(h.start);
          }
        }}
      />
    </div>
  );
}

// Re-export so consumers (settings UI) can import the action labels in one go.
export type { ClickAction, ClickActions };
