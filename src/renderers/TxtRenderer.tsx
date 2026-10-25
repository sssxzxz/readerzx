import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import type { Highlight, OpenedBook, ReaderSettings, SearchResult } from '@shared/types';
import { decodeText } from '@/lib/encoding';
import { useReaderStore } from '@/store/useReaderStore';
import type { RendererHandle, TocItem, TtsSnapshot } from './FoliateRenderer';

interface Props {
  book: OpenedBook;
  settings: ReaderSettings;
  seekTo: string | null;
  onProgress: (loc: string, percent: number, tocHref?: string | null) => void;
  onTocReady: (toc: TocItem[]) => void;
  onError: (msg: string) => void;
}

const TXT_CACHE_LIMIT = 3;
const UNMEASURED_PAGE_CHAR_LIMIT = 4000;
const decodedTextCache = new Map<string, { text: string; toc: TocItem[] }>();

/**
 * High-performance TXT renderer.
 *
 * Strategy: do NOT mount the entire book into the DOM. Instead, use an
 * offscreen probe element to compute page boundaries (char offsets) by
 * binary-searching how much text fits in `innerSize` under the current
 * font/column settings. Only the current page's text slice is mounted in
 * the visible page container. This makes navigation, font resizing, and
 * column changes all O(1) per page instead of O(book length).
 *
 * Highlights: the visible page text is split into <span data-start={offset}>
 * chunks at highlight boundaries. The data-start attribute is the char offset
 * (in the global decoded text) of that span's first character; this lets us
 * convert any DOM Range back to global char offsets.
 */
const TxtRenderer = forwardRef<RendererHandle, Props>(function TxtRenderer(
  { book, settings, seekTo, onProgress, onTocReady, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string>('');
  const [innerSize, setInnerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  /** Char offset of each page boundary; pageOffsets[i]..pageOffsets[i+1] is page i. */
  const pageOffsetsRef = useRef<number[]>([0]);
  const fullyPaginatedRef = useRef<boolean>(false);
  const localPaginationRef = useRef<boolean>(false);
  const pageNumberBaseRef = useRef<number>(0);

  const [knownPages, setKnownPages] = useState(1);
  const [estimatedTotal, setEstimatedTotal] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  /** Char offset to keep visible across reflows. */
  const anchorOffsetRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(settings.readingLayout);
  layoutRef.current = settings.readingLayout;

  // Highlights live in the global store; we read book-scoped notes via selector
  const allNotes = useReaderStore((s) => s.notes);
  const addNote = useReaderStore((s) => s.addNote);
  // Filter by current book and only TXT-format highlights (defensive)
  const notes = useMemo(
    () => allNotes.filter((n) => n.bookId === book.id && n.format === 'txt'),
    [allNotes, book.id],
  );

  // Decode text once + extract chapter TOC + seed anchor
  useEffect(() => {
    try {
      let cached = decodedTextCache.get(book.id);
      if (cached) {
        decodedTextCache.delete(book.id);
        decodedTextCache.set(book.id, cached);
      } else {
        const decoded = decodeText(book.data);
        const toc: TocItem[] = [];
        const re = /^[ \t　]*(第[一二三四五六七八九十百千零〇\d]+[章节回卷篇].*)$/gm;
        let m;
        while ((m = re.exec(decoded)) !== null) {
          toc.push({ label: m[1].trim().slice(0, 60), href: String(m.index) });
        }
        cached = { text: decoded, toc };
        decodedTextCache.set(book.id, cached);
        while (decodedTextCache.size > TXT_CACHE_LIMIT) {
          const oldestId = decodedTextCache.keys().next().value as string | undefined;
          if (!oldestId) break;
          decodedTextCache.delete(oldestId);
        }
      }
      const decoded = cached.text;
      setText(decoded);
      anchorOffsetRef.current = seekTo ? Math.max(0, parseInt(seekTo, 10) || 0) : 0;
      onTocReady(cached.toc);
    } catch (err: any) {
      onError(`无法解码文本：${err?.message ?? err}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Track container inner dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = Math.max(50, el.clientWidth - settings.pageMargin * 2);
      const h = Math.max(50, el.clientHeight - settings.pageMargin * 2);
      setInnerSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [settings.pageMargin]);

  // Repaginate from scratch whenever any layout-affecting input changes.
  useEffect(() => {
    if (settings.readingLayout === 'vertical') return;
    if (!text || !innerSize.w || !innerSize.h) return;
    const probe = probeRef.current;
    if (!probe) return;

    pageOffsetsRef.current = [0];
    fullyPaginatedRef.current = false;
    localPaginationRef.current = false;
    pageNumberBaseRef.current = 0;
    const offsets = pageOffsetsRef.current;

    const anchor = Math.max(0, Math.min(text.length - 1, anchorOffsetRef.current));
    let foundCurrent = anchor === 0;

    // A distant saved position should open locally instead of measuring
    // hundreds of pages from the beginning before the first useful paint.
    const SYNC_CAP = anchor > 50_000 ? 0 : 24;
    let syncCount = 0;
    while (!foundCurrent && syncCount < SYNC_CAP && !fullyPaginatedRef.current) {
      const lastOffset = offsets[offsets.length - 1];
      const avg = offsets.length > 1 ? lastOffset / (offsets.length - 1) : 1500;
      const end = findPageEnd(probe, text, lastOffset, avg);
      offsets.push(end);
      if (end >= text.length) fullyPaginatedRef.current = true;
      if (end > anchor) {
        foundCurrent = true;
        setCurrentPage(offsets.length - 2);
      }
      syncCount++;
    }
    if (foundCurrent && anchor === 0) setCurrentPage(0);
    if (!foundCurrent) {
      const localStart = anchor;
      pageOffsetsRef.current = [localStart];
      localPaginationRef.current = true;
      fullyPaginatedRef.current = localStart >= text.length;
      const localOffsets = pageOffsetsRef.current;
      for (let i = 0; i < 3 && !fullyPaginatedRef.current; i++) {
        const lastOffset = localOffsets[localOffsets.length - 1];
        const avg = averagePageChars(localOffsets) || 1500;
        const end = findPageEnd(probe, text, lastOffset, avg);
        localOffsets.push(end);
        if (end >= text.length) fullyPaginatedRef.current = true;
      }
      pageNumberBaseRef.current = estimatePageNumberBase(localOffsets, localStart);
      setCurrentPage(0);
    }
    const activeOffsets = pageOffsetsRef.current;
    if (activeOffsets.length === 1) {
      const end = findPageEnd(probe, text, 0, 1500);
      activeOffsets.push(end);
      if (end >= text.length) fullyPaginatedRef.current = true;
    }

    updatePaginationEstimates(
      activeOffsets,
      text.length,
      fullyPaginatedRef.current,
      localPaginationRef.current,
      pageNumberBaseRef.current,
      setKnownPages,
      setEstimatedTotal,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    text,
    innerSize.w,
    innerSize.h,
    settings.fontSize,
    settings.lineHeight,
    settings.fontFamily,
    settings.fontWeight,
    settings.columnCount,
    settings.readingLayout,
  ]);

  /** Ensure the boundary of `targetPage` exists in pageOffsets. */
  const ensurePage = useCallback(
    (targetPage: number): number => {
      const probe = probeRef.current;
      if (!probe || !text) return 0;
      const offs = pageOffsetsRef.current;
      while (offs.length <= targetPage + 1 && !fullyPaginatedRef.current) {
        const lastOffset = offs[offs.length - 1];
        const avg = averagePageChars(offs) || 1500;
        const end = findPageEnd(probe, text, lastOffset, avg);
        offs.push(end);
        if (end >= text.length) fullyPaginatedRef.current = true;
      }
      updatePaginationEstimates(
        offs,
        text.length,
        fullyPaginatedRef.current,
        localPaginationRef.current,
        pageNumberBaseRef.current,
        setKnownPages,
        setEstimatedTotal,
      );
      const max = offs.length - 2;
      return Math.min(targetPage, Math.max(0, max));
    },
    [text],
  );

  const ensurePrevPage = useCallback((): number => {
    const probe = probeRef.current;
    if (!probe || !text) return 0;
    const offs = pageOffsetsRef.current;
    if (currentPage > 0) return currentPage - 1;
    const first = offs[0] ?? 0;
    if (first <= 0) return 0;
    const avg = averagePageChars(offs) || 1500;
    const prevStart = findPageStartBefore(probe, text, first, avg);
    offs.unshift(prevStart);
    pageNumberBaseRef.current = Math.max(0, pageNumberBaseRef.current - 1);
    updatePaginationEstimates(
      offs,
      text.length,
      fullyPaginatedRef.current,
      localPaginationRef.current,
      pageNumberBaseRef.current,
      setKnownPages,
      setEstimatedTotal,
    );
    return 0;
  }, [currentPage, text]);

  // Persist current page anchor + report progress (paginated only)
  useEffect(() => {
    if (!text) return;
    if (settings.readingLayout === 'vertical') return;
    const offs = pageOffsetsRef.current;
    const start = offs[currentPage] ?? 0;
    anchorOffsetRef.current = start;
    const pct = text.length > 1 ? start / (text.length - 1) : 0;
    onProgress(String(start), Math.min(1, Math.max(0, pct)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, knownPages, estimatedTotal, text, settings.readingLayout]);

  const onVerticalScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !text.length) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max <= 0 ? 0 : el.scrollTop / max;
    const approx = Math.floor(pct * text.length);
    anchorOffsetRef.current = approx;
    onProgress(String(approx), Math.min(1, Math.max(0, pct)));
  }, [text, onProgress]);

  /** Initial + resize: sync vertical scroll metrics → progress. */
  useEffect(() => {
    if (settings.readingLayout !== 'vertical' || !text) return;
    const el = scrollRef.current;
    if (!el) return;
    onVerticalScroll();
  }, [text, settings.readingLayout, innerSize.w, innerSize.h, onVerticalScroll]);

  /** Restore reading position when opening or when seekTo is injected. */
  useEffect(() => {
    if (settings.readingLayout !== 'vertical' || !text) return;
    const el = scrollRef.current;
    if (!el) return;
    const offset = seekTo ? Math.max(0, parseInt(seekTo, 10) || 0) : 0;
    const id = requestAnimationFrame(() => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = text.length > 0 ? (offset / text.length) * max : 0;
    });
    return () => cancelAnimationFrame(id);
  }, [seekTo, book.id, text, settings.readingLayout, innerSize.w, innerSize.h]);

  /** Jump to a global char offset (used by TOC + by saved highlights). */
  const jumpToOffset = useCallback(
    (offset: number) => {
      if (isNaN(offset)) return;
      anchorOffsetRef.current = offset;
      if (layoutRef.current === 'vertical') {
        const el = scrollRef.current;
        if (!el || !text.length) return;
        requestAnimationFrame(() => {
          const max = Math.max(0, el.scrollHeight - el.clientHeight);
          el.scrollTop = (offset / text.length) * max;
        });
        return;
      }
      const probe = probeRef.current;
      if (!probe) return;
      const offs = pageOffsetsRef.current;

      const findExisting = () => {
        for (let i = 0; i < offs.length - 1; i++) {
          if (offs[i] <= offset && offset < offs[i + 1]) return i;
        }
        return -1;
      };
      let target = findExisting();
      if (target < 0) {
        let safety = 0;
        const JUMP_SYNC_CAP = 180;
        while (
          offs[offs.length - 1] <= offset &&
          !fullyPaginatedRef.current &&
          safety < JUMP_SYNC_CAP
        ) {
          const lastOffset = offs[offs.length - 1];
          const avg = averagePageChars(offs) || 1500;
          const end = findPageEnd(probe, text, lastOffset, avg);
          offs.push(end);
          if (end >= text.length) fullyPaginatedRef.current = true;
          safety++;
        }
        target = findExisting();
        if (target < 0) {
          const localStart = Math.max(0, Math.min(text.length - 1, offset));
          pageOffsetsRef.current = [localStart];
          localPaginationRef.current = true;
          fullyPaginatedRef.current = false;
          const localOffsets = pageOffsetsRef.current;
          for (let i = 0; i < 3 && !fullyPaginatedRef.current; i++) {
            const lastOffset = localOffsets[localOffsets.length - 1];
            const avg = averagePageChars(localOffsets) || 1500;
            const end = findPageEnd(probe, text, lastOffset, avg);
            localOffsets.push(end);
            if (end >= text.length) fullyPaginatedRef.current = true;
          }
          pageNumberBaseRef.current = estimatePageNumberBase(localOffsets, localStart);
          updatePaginationEstimates(
            localOffsets,
            text.length,
            fullyPaginatedRef.current,
            true,
            pageNumberBaseRef.current,
            setKnownPages,
            setEstimatedTotal,
          );
          setCurrentPage(0);
          return;
        }
      }
      updatePaginationEstimates(
        offs,
        text.length,
        fullyPaginatedRef.current,
        localPaginationRef.current,
        pageNumberBaseRef.current,
        setKnownPages,
        setEstimatedTotal,
      );
      setCurrentPage(Math.max(0, target));
    },
    [text],
  );

  useImperativeHandle(ref, () => ({
    next: () => {
      if (layoutRef.current === 'vertical') {
        const el = scrollRef.current;
        if (el) el.scrollBy({ top: el.clientHeight * 0.92, behavior: 'smooth' });
        return;
      }
      const target = currentPage + 1;
      const allowed = ensurePage(target);
      setCurrentPage(allowed);
    },
    prev: () => {
      if (layoutRef.current === 'vertical') {
        const el = scrollRef.current;
        if (el) el.scrollBy({ top: -el.clientHeight * 0.92, behavior: 'smooth' });
        return;
      }
      const allowed = ensurePrevPage();
      setCurrentPage(allowed);
    },
    goTo: (loc: string) => {
      const offset = parseInt(loc, 10);
      jumpToOffset(offset);
    },
    goToPercent: (percent: number) => {
      if (!text.length) return;
      jumpToOffset(Math.floor(Math.max(0, Math.min(1, percent)) * text.length));
    },
    getToc: async () => [],
    search: async (query: string) => searchText(text, query),
    goToSearchResult: (result: SearchResult) => {
      const offset = parseInt(result.location, 10);
      jumpToOffset(offset);
    },
    supportsHighlights: () => true,
    commitSelectionHighlight: (color: string) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      const root = containerRef.current;
      if (!root || !root.contains(range.commonAncestorContainer)) return null;

      const offs = rangeToOffsets(range);
      if (!offs || offs.end <= offs.start) return null;
      const start = Math.min(offs.start, offs.end);
      const end = Math.max(offs.start, offs.end);
      const snippet = text.slice(start, end).replace(/\s+/g, ' ').slice(0, 200);
      if (!snippet.trim()) {
        sel.removeAllRanges();
        return null;
      }
      const id =
        'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const highlight: Highlight = {
        id,
        bookId: book.id,
        format: 'txt',
        start: String(start),
        end: String(end),
        color,
        text: snippet,
        createdAt: Date.now(),
      };
      const rect = range.getBoundingClientRect();
      addNote(highlight);
      sel.removeAllRanges();
      return { id, rect };
    },
    goToHighlight: (start: string) => {
      const offset = parseInt(start, 10);
      jumpToOffset(offset);
    },
    getTtsSnapshot: (): TtsSnapshot => {
      if (!text) return { text: '', location: 'txt:empty', hasNext: false };
      if (layoutRef.current === 'vertical') {
        const start = Math.max(0, Math.min(text.length, anchorOffsetRef.current));
        const end = Math.min(text.length, findTtsChunkEnd(text, start));
        return {
          text: text.slice(start, end),
          location: `txt:${start}:${end}`,
          hasNext: end < text.length,
        };
      }
      const offs = pageOffsetsRef.current;
      const pageStart = offs[currentPage] ?? 0;
      const pageEnd =
        offs[currentPage + 1] ??
        Math.min(text.length, pageStart + UNMEASURED_PAGE_CHAR_LIMIT);
      return {
        text: text.slice(pageStart, pageEnd),
        location: `txt:${pageStart}:${pageEnd}`,
        hasNext: pageEnd < text.length,
      };
    },
  }));

  const gap = Math.max(8, Math.round(settings.fontSize * 0.8));
  const totalDisplay = Math.max(knownPages, estimatedTotal);
  const currentDisplayPage = pageNumberBaseRef.current + currentPage + 1;

  const baseTextStyles: React.CSSProperties = {
    fontSize: settings.fontSize + 'px',
    lineHeight: settings.lineHeight,
    fontFamily: settings.fontFamily,
    fontWeight: settings.fontWeight,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  };

  if (settings.readingLayout === 'vertical') {
    return (
      <div
        ref={containerRef}
        className="reader-content w-full h-full overflow-hidden relative"
        style={{
          padding: `${settings.pageMargin}px`,
          boxSizing: 'border-box',
        }}
      >
        <div
          ref={scrollRef}
          className="w-full h-full overflow-y-auto overflow-x-hidden scrollbar-thin"
          onScroll={onVerticalScroll}
          style={{
            height: '100%',
            boxSizing: 'border-box',
            ...baseTextStyles,
          }}
        >
          {text ? renderPageNodes(text, 0, text.length, notes) : null}
        </div>
      </div>
    );
  }

  // Compute current page text + highlight-aware spans
  const offs = pageOffsetsRef.current;
  const pageStart = offs[currentPage] ?? 0;
  const pageEnd =
    offs[currentPage + 1] ?? Math.min(text.length, pageStart + UNMEASURED_PAGE_CHAR_LIMIT);
  const pageText = text.slice(pageStart, pageEnd);

  return (
    <div
      ref={containerRef}
      className="reader-content w-full h-full overflow-hidden relative"
      style={{
        padding: `${settings.pageMargin}px`,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: innerSize.w || '100%',
          height: innerSize.h || '100%',
          columnCount: settings.columnCount,
          columnGap: gap + 'px',
          columnFill: 'auto',
          overflow: 'hidden',
          ...baseTextStyles,
        }}
      >
        {renderPageNodes(pageText, pageStart, pageEnd, notes)}
      </div>

      {/* Offscreen probe (same styles for accurate measurement) */}
      <div
        ref={probeRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: -100000,
          top: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          width: (innerSize.w || 100) + 'px',
          height: (innerSize.h || 100) + 'px',
          columnCount: settings.columnCount,
          columnGap: gap + 'px',
          columnFill: 'auto',
          overflow: 'hidden',
          contain: 'size layout style',
          ...baseTextStyles,
        }}
      />

      {totalDisplay > 1 && (
        <div className="absolute bottom-1 right-2 text-[10px] text-muted/70 pointer-events-none select-none">
          {currentDisplayPage} / {totalDisplay}
          {!fullyPaginatedRef.current || localPaginationRef.current ? '…' : ''}
        </div>
      )}
    </div>
  );
});

/**
 * Build the visible page's React nodes. Splits `pageText` at highlight
 * boundaries so each contiguous run is wrapped in a <span data-start={offset}>.
 * Highlight runs additionally get a translucent background and data-hid.
 *
 * Overlapping highlights: earlier-start ones win for any overlap. This keeps
 * the algorithm simple and is rarely visible in practice.
 */
function renderPageNodes(
  pageText: string,
  pageStart: number,
  pageEnd: number,
  highlights: Highlight[],
): React.ReactNode {
  // Filter to highlights that intersect this page, then clip and dedupe overlaps.
  const inPage = highlights
    .map((h) => ({
      id: h.id,
      color: h.color,
      start: parseInt(h.start, 10),
      end: parseInt(h.end, 10),
    }))
    .filter((h) => Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start)
    .filter((h) => h.end > pageStart && h.start < pageEnd)
    .map((h) => ({
      ...h,
      start: Math.max(h.start, pageStart),
      end: Math.min(h.end, pageEnd),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const adjusted: typeof inPage = [];
  let lastEnd = pageStart;
  for (const h of inPage) {
    const s = Math.max(h.start, lastEnd);
    if (s < h.end) {
      adjusted.push({ ...h, start: s });
      lastEnd = h.end;
    }
  }

  if (adjusted.length === 0) {
    return (
      <span data-start={pageStart}>
        {pageText || '\u00A0'}
      </span>
    );
  }

  const nodes: React.ReactNode[] = [];
  let cursor = pageStart;
  for (const h of adjusted) {
    if (h.start > cursor) {
      nodes.push(
        <span key={`p-${cursor}`} data-start={cursor}>
          {pageText.slice(cursor - pageStart, h.start - pageStart)}
        </span>,
      );
    }
    nodes.push(
      <span
        key={`h-${h.id}-${h.start}`}
        data-start={h.start}
        data-hid={h.id}
        style={{
          backgroundColor: h.color,
          borderRadius: '0.15em',
          padding: '0 0.05em',
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }}
      >
        {pageText.slice(h.start - pageStart, h.end - pageStart)}
      </span>,
    );
    cursor = h.end;
  }
  if (cursor < pageEnd) {
    nodes.push(
      <span key={`p-${cursor}`} data-start={cursor}>
        {pageText.slice(cursor - pageStart)}
      </span>,
    );
  }
  return <>{nodes}</>;
}

/** Walk up from a node until we find an HTMLElement carrying data-start. */
function findDataStartSpan(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.start !== undefined) return el;
    el = el.parentNode;
  }
  return null;
}

/**
 * Convert a DOM Range that lives inside our text page (whose <span>s carry
 * data-start) to a {start, end} pair of global char offsets.
 */
function rangeToOffsets(range: Range): { start: number; end: number } | null {
  const sStart = nodeToGlobalOffset(range.startContainer, range.startOffset);
  const sEnd = nodeToGlobalOffset(range.endContainer, range.endOffset);
  if (sStart == null || sEnd == null) return null;
  return { start: sStart, end: sEnd };
}

function nodeToGlobalOffset(node: Node, offset: number): number | null {
  // Case 1: text node — its parent (or some ancestor) carries data-start
  if (node.nodeType === Node.TEXT_NODE) {
    const span = findDataStartSpan(node);
    if (!span) return null;
    const base = parseInt(span.dataset.start || '0', 10);
    if (isNaN(base)) return null;
    // Sum text length of preceding siblings inside the same span (multiple
    // text nodes can occur if React inserts comment markers, etc.)
    let prefix = 0;
    let cur: Node | null = node.previousSibling;
    while (cur) {
      prefix += cur.textContent?.length ?? 0;
      cur = cur.previousSibling;
    }
    return base + prefix + offset;
  }

  // Case 2: element node — offset is the index of children
  if (node instanceof HTMLElement) {
    if (node.dataset.start !== undefined) {
      const base = parseInt(node.dataset.start || '0', 10);
      if (isNaN(base)) return null;
      // Sum text length of `offset` first children
      let prefix = 0;
      for (let i = 0; i < Math.min(offset, node.childNodes.length); i++) {
        prefix += node.childNodes[i].textContent?.length ?? 0;
      }
      return base + prefix;
    }
    // No data-start — try a child that has one (use the first/last child as appropriate)
    const child =
      offset < node.childNodes.length ? node.childNodes[offset] : node.lastChild;
    if (child) return nodeToGlobalOffset(child, 0);
  }
  return null;
}

/**
 * Find the largest `end >= start+1` such that `text.slice(start, end)` fits in
 * the probe (i.e. doesn't overflow into extra columns). Geometric doubling to
 * bracket, then binary search to refine.
 */
function averagePageChars(offsets: number[]): number {
  if (offsets.length < 2) return 0;
  const first = offsets[0];
  const last = offsets[offsets.length - 1];
  return Math.max(1, (last - first) / (offsets.length - 1));
}

function estimatePageNumberBase(offsets: number[], start: number): number {
  const avg = averagePageChars(offsets) || 1500;
  return Math.max(0, Math.floor(start / avg));
}

function updatePaginationEstimates(
  offsets: number[],
  textLength: number,
  fullyPaginated: boolean,
  localPagination: boolean,
  pageNumberBase: number,
  setKnownPages: (n: number) => void,
  setEstimatedTotal: (n: number) => void,
): void {
  const pagesKnown = Math.max(1, offsets.length - 1);
  if (!localPagination) {
    setKnownPages(pagesKnown);
    const charsKnown = offsets[offsets.length - 1] ?? 0;
    if (fullyPaginated) setEstimatedTotal(pagesKnown);
    else if (charsKnown > 0)
      setEstimatedTotal(Math.max(pagesKnown, Math.ceil((textLength * pagesKnown) / charsKnown)));
    else setEstimatedTotal(pagesKnown);
    return;
  }

  const avg = averagePageChars(offsets) || 1500;
  const tailRemaining = Math.max(0, textLength - (offsets[offsets.length - 1] ?? 0));
  const estimatedTailPages = fullyPaginated ? 0 : Math.ceil(tailRemaining / avg);
  const total = Math.max(
    pageNumberBase + pagesKnown,
    pageNumberBase + pagesKnown + estimatedTailPages,
  );
  setKnownPages(pageNumberBase + pagesKnown);
  setEstimatedTotal(total);
}

function findPageEnd(
  probe: HTMLElement,
  text: string,
  start: number,
  hint: number,
): number {
  if (start >= text.length) return text.length;
  const innerW = probe.clientWidth;
  if (innerW <= 0) return Math.min(text.length, start + 100);

  const initial = Math.max(200, Math.min(50000, Math.ceil(hint * 1.4)));
  let lo = start;
  let hi = Math.min(text.length, start + initial);

  probe.textContent = text.slice(start, hi);
  let overflow = probe.scrollWidth > innerW + 0.5;

  let safety = 0;
  while (!overflow && safety < 32) {
    if (hi >= text.length) return text.length;
    lo = hi;
    hi = Math.min(text.length, start + (hi - start) * 2);
    probe.textContent = text.slice(start, hi);
    overflow = probe.scrollWidth > innerW + 0.5;
    safety++;
  }

  if (!overflow) return text.length;

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    probe.textContent = text.slice(start, mid);
    if (probe.scrollWidth > innerW + 0.5) hi = mid;
    else lo = mid;
  }

  return Math.max(start + 1, lo);
}

function findPageStartBefore(
  probe: HTMLElement,
  text: string,
  end: number,
  hint: number,
): number {
  if (end <= 0) return 0;
  const innerW = probe.clientWidth;
  if (innerW <= 0) return Math.max(0, end - Math.max(100, Math.round(hint)));

  const fits = (start: number) => {
    probe.textContent = text.slice(start, end);
    return probe.scrollWidth <= innerW + 0.5;
  };

  const binarySmallestFit = (loNonFit: number, hiFit: number) => {
    let lo = loNonFit;
    let hi = hiFit;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return Math.max(0, Math.min(hi, end - 1));
  };

  const initialSpan = Math.max(200, Math.ceil(hint * 1.4));
  let fitStart = Math.max(0, end - initialSpan);

  if (!fits(fitStart)) {
    return binarySmallestFit(fitStart, end - 1);
  }

  let span = end - fitStart;
  while (fitStart > 0) {
    const candidate = Math.max(0, end - span * 2);
    if (fits(candidate)) {
      fitStart = candidate;
      if (candidate === 0) return 0;
      span = end - fitStart;
      continue;
    }
    return binarySmallestFit(candidate, fitStart);
  }
  return fitStart;
}

function findTtsChunkEnd(text: string, start: number): number {
  const max = Math.min(text.length, start + 1800);
  if (max >= text.length) return text.length;
  const slice = text.slice(start, max);
  const boundary = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?'),
    slice.lastIndexOf('\n'),
  );
  return start + (boundary > 300 ? boundary + 1 : slice.length);
}

function searchText(text: string, query: string): SearchResult[] {
  const q = query.trim();
  if (!text || !q) return [];
  const haystack = text.toLocaleLowerCase();
  const needle = q.toLocaleLowerCase();
  const results: SearchResult[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    results.push({
      id: `txt-${index}`,
      location: String(index),
      excerpt: excerptAround(text, index, q.length),
      percent: text.length > 0 ? index / text.length : 0,
    });
    if (results.length >= 200) break;
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
  return results;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + length + 50);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`.replace(/\s+/g, ' ');
}

export default TxtRenderer;
