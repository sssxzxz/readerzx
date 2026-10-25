import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  EventBus,
  PDFLinkService,
  PDFFindController,
  PDFSinglePageViewer,
  PDFViewer,
  ScrollMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OpenedBook, ReaderSettings, SearchResult } from '@shared/types';
import type { RendererHandle, TocItem, TtsSnapshot } from './FoliateRenderer';

(pdfjsLib.GlobalWorkerOptions as any).workerSrc = pdfWorkerUrl;

interface Props {
  book: OpenedBook;
  settings: ReaderSettings;
  seekTo: string | null;
  onProgress: (loc: string, percent: number, tocHref?: string | null) => void;
  onTocReady: (toc: TocItem[]) => void;
  onError: (msg: string) => void;
  onPdfScaleChange: (
    mode: ReaderSettings['pdfScaleMode'],
    scale?: number,
  ) => void;
  onAreaClick?: (clientX: number) => void;
  onButtonClick?: (button: 1 | 2) => void;
}

type PdfBinaryInput = ArrayBuffer | ArrayBufferView | number[];

interface PdfViewerApi {
  eventBus: any;
  linkService: any;
  findController: any;
  viewer: any;
}

interface PdfAnchor {
  page: number;
  pageOffsetRatio: number;
}

const PDF_LOAD_TIMEOUT_MS = 45_000;
const PDF_WORKER_FALLBACK_MS = 6_000;
const PDF_OUTLINE_TIMEOUT_MS = 8_000;
const PDF_RENDER_TIMEOUT_MS = 30_000;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

const PdfRenderer = forwardRef<RendererHandle, Props>(function PdfRenderer(
  {
    book,
    settings,
    seekTo,
    onProgress,
    onTocReady,
    onError,
    onPdfScaleChange,
    onAreaClick,
    onButtonClick,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const loadingTaskRef = useRef<any>(null);
  const apiRef = useRef<PdfViewerApi | null>(null);
  const anchorRef = useRef<PdfAnchor>({ page: 1, pageOffsetRatio: 0 });
  const currentPageRef = useRef(1);
  const numPagesRef = useRef(0);
  const [loadingMsg, setLoadingMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    const viewerEl = viewerElRef.current;
    if (!container || !viewerEl) return;

    const startedAt = performance.now();
    const setStage = (msg: string) => {
      if (cancelled) return;
      const text = `${msg}（${formatElapsed(performance.now() - startedAt)}）`;
      console.info(`[PDF] ${book.name}: ${text}`);
      setLoadingMsg(text);
    };

    const cleanup = () => {
      cancelled = true;
      try {
        loadingTaskRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      try {
        apiRef.current?.viewer?.setDocument?.(null);
        apiRef.current?.linkService?.setDocument?.(null);
        docRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
      docRef.current = null;
      loadingTaskRef.current = null;
      numPagesRef.current = 0;
      viewerEl.replaceChildren();
    };

    (async () => {
      try {
        container.scrollTop = 0;
        viewerEl.replaceChildren();
        onTocReady([]);
        setStage(`正在准备 PDF 数据 ${formatBytes(book.size)}`);
        const data = copyPdfData(book.data as PdfBinaryInput);

        const eventBus = new EventBus();
        const linkService = new PDFLinkService({
          eventBus,
          externalLinkTarget: 2,
          externalLinkRel: 'noopener noreferrer',
        });
        const findController = new PDFFindController({ eventBus, linkService });
        const ViewerCtor = settings.pdfMode === 'single' ? PDFSinglePageViewer : PDFViewer;
        console.info(`[PDF] ${book.name}: mode=${settings.pdfMode}, viewer=${ViewerCtor.name}`);
        const viewer = new ViewerCtor({
          container,
          viewer: viewerEl,
          eventBus,
          linkService,
          findController,
          removePageBorders: false,
          maxCanvasPixels: 4096 * 4096,
        });
        linkService.setViewer(viewer);
        apiRef.current = { eventBus, linkService, findController, viewer };

        bindViewerEvents(eventBus, viewer, container, currentPageRef, onProgress);

        setStage(`正在解析 PDF ${formatBytes(data.byteLength)}`);
        const doc = await loadPdfDocumentWithFallback(data, setStage, (task) => {
          loadingTaskRef.current = task;
        });
        if (cancelled) return;

        docRef.current = doc;
        numPagesRef.current = doc.numPages;
        const initialAnchor = parsePdfLocation(seekTo, doc.numPages);
        const targetPage = initialAnchor.page;
        currentPageRef.current = targetPage;
        anchorRef.current = initialAnchor;

        setStage(`PDF 已解析，共 ${doc.numPages} 页，正在打开第 ${targetPage} 页`);
        const pagesInitPromise = waitForEvent(eventBus, 'pagesinit', PDF_RENDER_TIMEOUT_MS);
        viewer.setDocument(doc);
        linkService.setDocument(doc, null);
        findController.setDocument(doc);

        await pagesInitPromise;
        if (cancelled) return;
        if (settings.pdfMode !== 'single') {
          viewer.scrollMode = ScrollMode.VERTICAL;
        }
        console.info(`[PDF] ${book.name}: pagesinit scrollMode=${viewer.scrollMode}`);
        applyPdfScale(viewer, settings);
        viewer.currentPageNumber = targetPage;
        restoreAnchor(container, viewer, anchorRef.current);
        console.info(
          `[PDF] ${book.name}: 首屏已就绪，第 ${targetPage} / ${doc.numPages} 页（${formatElapsed(
            performance.now() - startedAt,
          )}）`,
        );
        setLoadingMsg('');
        reportProgress(targetPage, doc.numPages, onProgress, initialAnchor.pageOffsetRatio);

        void withTimeout(
          loadPdfToc(doc),
          PDF_OUTLINE_TIMEOUT_MS,
          `PDF 目录读取超过 ${formatElapsed(PDF_OUTLINE_TIMEOUT_MS)}`,
        )
          .then((toc) => {
            if (!cancelled) onTocReady(toc);
          })
          .catch((err) => console.warn('PDF TOC diagnostic:', err));
      } catch (err: any) {
        console.error('PDF load error:', err);
        setLoadingMsg('');
        const extra = isTimeoutError(err)
          ? '。这个体积的 PDF 不该这么久，可能是 Worker、首屏渲染或某个 PDF 对象卡住。'
          : '';
        onError(`无法打开 PDF：${err?.message ?? err}${extra}`);
      }
    })();

    return cleanup;
    // Recreate the official viewer only when the book or fixed/single mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, settings.pdfMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: number | null = null;
    const ro = new ResizeObserver(() => {
      const api = apiRef.current;
      if (!api?.viewer || !docRef.current) return;
      anchorRef.current = getCurrentAnchor(container, api.viewer, currentPageRef.current);
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const anchor = anchorRef.current;
        try {
          applyPdfScale(api.viewer, settings);
          api.viewer.currentPageNumber = anchor.page;
          requestAnimationFrame(() => restoreAnchor(container, api.viewer, anchor));
        } catch (err) {
          console.warn('PDF resize restore failed:', err);
        }
      }, 120);
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [book.id, settings.pdfScale, settings.pdfScaleMode]);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = apiRef.current?.viewer;
    if (!container || !viewer || !docRef.current) return;
    const anchor = getCurrentAnchor(container, viewer, currentPageRef.current);
    try {
      applyPdfScale(viewer, settings);
      requestAnimationFrame(() => restoreAnchor(container, viewer, anchor));
    } catch (err) {
      console.warn('PDF scale update failed:', err);
    }
  }, [settings.pdfScale, settings.pdfScaleMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const api = apiRef.current;
      if (!api?.viewer || !numPagesRef.current) return;
      anchorRef.current = getCurrentAnchor(container, api.viewer, currentPageRef.current);
      currentPageRef.current = anchorRef.current.page;
      reportProgress(
        currentPageRef.current,
        numPagesRef.current,
        onProgress,
        anchorRef.current.pageOffsetRatio,
      );
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [book.id, onProgress]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      const viewer = apiRef.current?.viewer;
      if (!viewer) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = getCurrentAnchor(container, viewer, currentPageRef.current);
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = clamp(viewer.currentScale * factor, MIN_SCALE, MAX_SCALE);
      viewer.currentScale = nextScale;
      onPdfScaleChange('custom', Math.round(nextScale * 100));
      requestAnimationFrame(() => restoreAnchor(container, viewer, anchor));
    };
    container.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => container.removeEventListener('wheel', onWheel, { capture: true } as any);
  }, [book.id, onPdfScaleChange]);

  useImperativeHandle(ref, () => ({
    next: () => {
      const viewer = apiRef.current?.viewer;
      const container = containerRef.current;
      if (!viewer || !container || !numPagesRef.current) return;
      if (settings.pdfMode === 'single') {
        viewer.currentPageNumber = Math.min(numPagesRef.current, viewer.currentPageNumber + 1);
        return;
      }
      container.scrollBy({ top: container.clientHeight * 0.9, behavior: 'smooth' });
    },
    prev: () => {
      const viewer = apiRef.current?.viewer;
      const container = containerRef.current;
      if (!viewer || !container) return;
      if (settings.pdfMode === 'single') {
        viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1);
        return;
      }
      container.scrollBy({ top: -container.clientHeight * 0.9, behavior: 'smooth' });
    },
    goTo: (loc: string) => {
      const viewer = apiRef.current?.viewer;
      if (!viewer || !numPagesRef.current) return;
      const anchor = parsePdfLocation(loc, numPagesRef.current);
      viewer.currentPageNumber = anchor.page;
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) restoreAnchor(container, viewer, anchor);
      });
    },
    goToPercent: (percent: number) => {
      const viewer = apiRef.current?.viewer;
      if (!viewer || !numPagesRef.current) return;
      const target = Math.min(
        numPagesRef.current,
        Math.max(1, Math.round(clamp(percent, 0, 1) * (numPagesRef.current - 1)) + 1),
      );
      viewer.currentPageNumber = target;
    },
    getToc: async () => {
      try {
        return await withTimeout(
          loadPdfToc(docRef.current),
          PDF_OUTLINE_TIMEOUT_MS,
          `PDF 目录读取超过 ${formatElapsed(PDF_OUTLINE_TIMEOUT_MS)}`,
        );
      } catch {
        return [];
      }
    },
    search: async (query: string) => {
      const doc = docRef.current;
      const q = query.trim();
      if (!doc || !q || !numPagesRef.current) return [];
      highlightPdfQuery(apiRef.current, q);
      return searchPdf(doc, q, numPagesRef.current);
    },
    goToSearchResult: (result: SearchResult) => {
      const viewer = apiRef.current?.viewer;
      if (!viewer || !numPagesRef.current) return;
      const anchor = parsePdfLocation(result.location, numPagesRef.current);
      viewer.currentPageNumber = anchor.page;
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (container) restoreAnchor(container, viewer, anchor);
      });
    },
    getTtsSnapshot: async (): Promise<TtsSnapshot> => {
      const doc = docRef.current;
      const numPages = numPagesRef.current;
      if (!doc || !numPages) return { text: '', location: 'pdf:unready', hasNext: false };
      const pageNum = Math.min(numPages, Math.max(1, currentPageRef.current));
      try {
        const page = await doc.getPage(pageNum);
        const tc = await page.getTextContent();
        const text = tc.items
          .map((it: any) => it.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { text, location: `pdf:${pageNum}`, hasNext: pageNum < numPages };
      } catch {
        return { text: '', location: `pdf:${pageNum}`, hasNext: pageNum < numPages };
      }
    },
    zoomIn: () => {
      changePdfScale(1.1, containerRef, apiRef, currentPageRef, onPdfScaleChange);
    },
    zoomOut: () => {
      changePdfScale(0.9, containerRef, apiRef, currentPageRef, onPdfScaleChange);
    },
    resetZoom: () => onPdfScaleChange('width'),
  }));

  return (
    <div className="reader-content pdf-reader-shell w-full h-full relative overflow-hidden">
      <div
        ref={containerRef}
        className="pdf-reader-container absolute inset-0 overflow-auto scrollbar-thin"
        style={{ '--pdf-page-margin': `${settings.pageMargin}px` } as CSSProperties}
        onClick={(event) => {
          if (!onAreaClick || event.button !== 0 || shouldIgnorePdfClick(event.target)) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          onAreaClick(event.clientX);
        }}
        onAuxClick={(event) => {
          if (!onButtonClick || shouldIgnorePdfClick(event.target)) return;
          if (event.button !== 1 && event.button !== 2) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          event.preventDefault();
          onButtonClick(event.button);
        }}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onContextMenu={(event) => {
          if (onButtonClick) event.preventDefault();
        }}
      >
        <div ref={viewerElRef} className="pdfViewer" />
      </div>
      {loadingMsg && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-panel/90 text-fg text-xs shadow z-10 pointer-events-none">
          {loadingMsg}
        </div>
      )}
    </div>
  );
});

function applyPdfScale(viewer: any, settings: ReaderSettings): void {
  if (settings.pdfScaleMode === 'page') {
    viewer.currentScaleValue = 'page-fit';
    return;
  }
  if (settings.pdfScaleMode === 'custom') {
    viewer.currentScale = clamp((settings.pdfScale || 100) / 100, MIN_SCALE, MAX_SCALE);
    return;
  }
  viewer.currentScaleValue = 'page-width';
}

function changePdfScale(
  factor: number,
  containerRef: MutableRefObject<HTMLDivElement | null>,
  apiRef: MutableRefObject<PdfViewerApi | null>,
  currentPageRef: MutableRefObject<number>,
  onPdfScaleChange: Props['onPdfScaleChange'],
): void {
  const container = containerRef.current;
  const viewer = apiRef.current?.viewer;
  if (!container || !viewer) return;
  const anchor = getCurrentAnchor(container, viewer, currentPageRef.current);
  const nextScale = clamp(viewer.currentScale * factor, MIN_SCALE, MAX_SCALE);
  viewer.currentScale = nextScale;
  onPdfScaleChange('custom', Math.round(nextScale * 100));
  requestAnimationFrame(() => restoreAnchor(container, viewer, anchor));
}

function shouldIgnorePdfClick(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('a, button, input, select, textarea');
}

class PdfTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTimeoutError';
  }
}

function bindViewerEvents(
  eventBus: any,
  viewer: any,
  container: HTMLDivElement,
  currentPageRef: MutableRefObject<number>,
  onProgress: Props['onProgress'],
): void {
  eventBus.on('pagechanging', (evt: { pageNumber: number }) => {
    if (!evt?.pageNumber) return;
    const pages = viewer.pagesCount || 0;
    currentPageRef.current = pages
      ? Math.min(pages, Math.max(1, evt.pageNumber))
      : Math.max(1, evt.pageNumber);
    if (pages) {
      const anchor = getCurrentAnchor(container, viewer, currentPageRef.current);
      reportProgress(evt.pageNumber, pages, onProgress, anchor.pageOffsetRatio);
    }
  });
  eventBus.on('updateviewarea', () => {
    const pages = viewer.pagesCount || 0;
    if (!pages) return;
    const anchor = getCurrentAnchor(container, viewer, viewer.currentPageNumber || 1);
    const page = Math.min(pages, Math.max(1, anchor.page));
    currentPageRef.current = page;
    reportProgress(page, pages, onProgress, anchor.pageOffsetRatio);
  });
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof PdfTimeoutError || (err as Error)?.name === 'PdfTimeoutError';
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | null = null;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new PdfTimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) window.clearTimeout(timer);
  });
}

function waitForEvent(eventBus: any, eventName: string, timeoutMs: number): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      const handler = () => {
        eventBus.off?.(eventName, handler);
        resolve();
      };
      eventBus.on(eventName, handler);
    }),
    timeoutMs,
    `PDF 首屏初始化超过 ${formatElapsed(timeoutMs)}`,
  );
}

async function loadPdfDocumentWithFallback(
  sourceData: Uint8Array,
  setStage: (msg: string) => void,
  setLoadingTask: (task: any) => void,
): Promise<any> {
  const workerData = sourceData.slice();
  const fallbackData = sourceData.slice();
  let task = pdfjsLib.getDocument({ data: workerData });
  setLoadingTask(task);
  task.onProgress = (progress: { loaded?: number; total?: number }) => {
    setStage(`正在解析 PDF ${formatPdfProgress(progress, sourceData.byteLength)}`);
  };

  try {
    return await withTimeout(
      task.promise,
      PDF_WORKER_FALLBACK_MS,
      `PDF Worker 解析超过 ${formatElapsed(PDF_WORKER_FALLBACK_MS)}`,
    );
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    console.warn('PDF worker stalled; retrying without worker.', err);
    try {
      await task.destroy?.();
    } catch {
      /* ignore */
    }
  }

  setStage('PDF Worker 响应慢，正在切换到兼容模式');
  task = pdfjsLib.getDocument({ data: fallbackData, disableWorker: true });
  setLoadingTask(task);
  task.onProgress = (progress: { loaded?: number; total?: number }) => {
    setStage(`兼容模式解析 PDF ${formatPdfProgress(progress, sourceData.byteLength)}`);
  };
  return withTimeout(
    task.promise,
    PDF_LOAD_TIMEOUT_MS,
    `PDF 解析超过 ${formatElapsed(PDF_LOAD_TIMEOUT_MS)}，已停止本次打开`,
  );
}

function getCurrentAnchor(
  container: HTMLDivElement,
  viewer: any,
  fallbackPage: number,
): PdfAnchor {
  const page = Math.min(viewer.pagesCount || fallbackPage, Math.max(1, viewer.currentPageNumber || fallbackPage));
  const pageView = viewer.getPageView?.(page - 1);
  const pageDiv = pageView?.div as HTMLElement | undefined;
  if (!pageDiv || pageDiv.offsetHeight <= 0) return { page, pageOffsetRatio: 0 };
  const offsetIntoPage = Math.max(0, container.scrollTop - pageDiv.offsetTop);
  return { page, pageOffsetRatio: clamp(offsetIntoPage / pageDiv.offsetHeight, 0, 1) };
}

function restoreAnchor(container: HTMLDivElement, viewer: any, anchor: PdfAnchor): void {
  const page = Math.min(viewer.pagesCount || anchor.page, Math.max(1, anchor.page));
  const pageView = viewer.getPageView?.(page - 1);
  const pageDiv = pageView?.div as HTMLElement | undefined;
  if (!pageDiv) {
    viewer.currentPageNumber = page;
    return;
  }
  container.scrollTop = pageDiv.offsetTop + pageDiv.offsetHeight * anchor.pageOffsetRatio;
}

function reportProgress(
  page: number,
  numPages: number,
  onProgress: Props['onProgress'],
  pageOffsetRatio = 0,
): void {
  const safePage = Math.min(numPages, Math.max(1, page));
  onProgress(
    formatPdfLocation(safePage, pageOffsetRatio),
    numPages > 1 ? (safePage - 1) / (numPages - 1) : 0,
  );
}

function highlightPdfQuery(api: PdfViewerApi | null, query: string): void {
  api?.eventBus?.dispatch?.('find', {
    source: api.findController,
    type: '',
    query,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
    matchDiacritics: true,
  });
}

function normalizePageNumber(loc: string | null, numPages: number): number {
  return parsePdfLocation(loc, numPages).page;
}

function parsePdfLocation(loc: string | null, numPages: number): PdfAnchor {
  const [pageRaw, ratioRaw] = String(loc ?? '1').split('@');
  const pageNum = parseInt(pageRaw, 10);
  const ratioNum = ratioRaw != null ? parseFloat(ratioRaw) : 0;
  return {
    page: Math.min(numPages, Math.max(1, Number.isFinite(pageNum) ? pageNum : 1)),
    pageOffsetRatio: clamp(Number.isFinite(ratioNum) ? ratioNum : 0, 0, 1),
  };
}

function formatPdfLocation(page: number, pageOffsetRatio: number): string {
  const ratio = clamp(pageOffsetRatio, 0, 1);
  if (ratio <= 0.001) return String(page);
  return `${page}@${ratio.toFixed(4)}`;
}

function copyPdfData(input: PdfBinaryInput): Uint8Array {
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }
  if (ArrayBuffer.isView(input)) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    return copy;
  }
  return Uint8Array.from(input);
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatPdfProgress(
  progress: { loaded?: number; total?: number },
  fallbackTotal: number,
): string {
  const loaded = Math.max(0, progress.loaded ?? 0);
  const total = Math.max(progress.total ?? 0, fallbackTotal);
  if (!total) return formatBytes(loaded);
  const percent = Math.min(100, Math.round((loaded / total) * 100));
  return `${percent}% ${formatBytes(loaded)} / ${formatBytes(total)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function loadPdfToc(doc: any): Promise<TocItem[]> {
  if (!doc) return [];
  const outline = await doc.getOutline();
  return buildPdfToc(doc, outline ?? []);
}

async function buildPdfToc(doc: any, outline: any[]): Promise<TocItem[]> {
  if (!Array.isArray(outline)) return [];
  const items = await Promise.all(
    outline.map(async (o) => ({
      label: o.title ?? '',
      href: await resolvePdfDestPage(doc, o.dest),
      subitems: await buildPdfToc(doc, o.items ?? []),
    })),
  );
  return items;
}

async function resolvePdfDestPage(doc: any, dest: any): Promise<string> {
  try {
    if (!doc || !dest) return '';
    const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const ref = Array.isArray(target) ? target[0] : null;
    if (!ref) return '';
    const pageIndex = await doc.getPageIndex(ref);
    return String(pageIndex + 1);
  } catch {
    return '';
  }
}

async function searchPdf(doc: any, query: string, numPages: number): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const needle = query.toLocaleLowerCase();
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const tc = await page.getTextContent();
      const pageText = tc.items.map((it: any) => it.str).join(' ').replace(/\s+/g, ' ');
      const lower = pageText.toLocaleLowerCase();
      let index = lower.indexOf(needle);
      while (index >= 0) {
        results.push({
          id: `pdf-${pageNum}-${index}`,
          location: String(pageNum),
          label: `Page ${pageNum}`,
          excerpt: excerptAround(pageText, index, query.length),
          percent: numPages > 1 ? (pageNum - 1) / (numPages - 1) : 0,
        });
        if (results.length >= 200) return results;
        index = lower.indexOf(needle, index + Math.max(1, needle.length));
      }
    } catch (e) {
      console.warn(`search page ${pageNum} failed`, e);
    }
  }
  return results;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + length + 50);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export default PdfRenderer;
