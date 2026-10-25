import { useEffect, useMemo, useRef } from 'react';
import { useReaderStore } from '@/store/useReaderStore';
import type { TocItem } from '@/renderers/FoliateRenderer';
import type { Highlight } from '@shared/types';

interface Props {
  toc: TocItem[];
  onJump: (href: string) => void;
}

interface FlatTocItem {
  item: TocItem;
  depth: number;
  key: string;
}

export default function TocPanel({ toc, onJump }: Props) {
  const {
    showToc,
    toggleToc,
    currentLocation,
    currentTocHref,
    notes,
    book,
  } = useReaderStore();

  const flat = useMemo(() => flattenToc(toc), [toc]);
  const activeKey = useMemo(
    () => getActiveKey(flat, currentLocation, currentTocHref),
    [flat, currentLocation, currentTocHref],
  );
  const noteMarks = useMemo(
    () => getNoteMarks(flat, book?.id ?? null, notes),
    [flat, book?.id, notes],
  );

  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!showToc) return;
    const id = window.requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [showToc, activeKey]);

  if (!showToc) return null;
  return (
    <div
      className="absolute inset-0 z-30 bg-black/40"
      onClick={() => toggleToc()}
    >
      <div
        className="absolute top-12 left-0 bottom-7 w-80 bg-panel shadow-xl overflow-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 sticky top-0 bg-panel border-b border-muted/20 flex items-center z-10">
          <h3 className="font-bold flex-1">目录</h3>
          <button
            onClick={() => toggleToc()}
            className="text-muted hover:text-fg"
            title="关闭目录"
          >
            ×
          </button>
        </div>
        {toc.length === 0 ? (
          <div className="p-4 text-muted text-sm">无可用目录</div>
        ) : (
          <ul className="py-2">
            {flat.map(({ item, depth, key }) => {
              const active = key === activeKey;
              const colors = noteMarks.get(key) ?? [];
              return (
                <li key={key}>
                  <button
                    ref={active ? activeRef : undefined}
                    onClick={() => item.href && onJump(item.href)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                      active
                        ? 'bg-accent/20 text-fg font-semibold border-l-2 border-accent'
                        : 'hover:bg-muted/15 border-l-2 border-transparent'
                    }`}
                    style={{ paddingLeft: 12 + depth * 14 }}
                    title={item.label}
                  >
                    <span className="flex-1 min-w-0 truncate">
                      {item.label || '(无标题)'}
                    </span>
                    {colors.length > 0 && (
                      <span className="shrink-0 flex -space-x-1" title="本章有划线笔记">
                        {colors.slice(0, 3).map((color, index) => (
                          <span
                            key={`${color}-${index}`}
                            className="w-2.5 h-2.5 rounded-full border border-panel"
                            style={{ background: color }}
                          />
                        ))}
                      </span>
                    )}
                    {active && (
                      <span className="shrink-0 text-[10px] text-accent">当前</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function flattenToc(items: TocItem[], depth = 0, prefix = ''): FlatTocItem[] {
  const out: FlatTocItem[] = [];
  items.forEach((item, index) => {
    const key = `${prefix}${index}:${item.href || item.label || 'item'}`;
    out.push({ item, depth, key });
    if (item.subitems?.length) out.push(...flattenToc(item.subitems, depth + 1, `${key}/`));
  });
  return out;
}

function getActiveKey(
  flat: FlatTocItem[],
  currentLocation: string | null,
  currentTocHref: string | null,
): string | null {
  if (!flat.length) return null;
  const href = currentTocHref || currentLocation;
  if (href) {
    const exact = flat.find(({ item }) => sameHref(item.href, href));
    if (exact) return exact.key;
  }

  const loc = parseNumericLocation(currentLocation);
  if (loc == null) return null;

  let active: FlatTocItem | null = null;
  for (const entry of flat) {
    const itemLoc = parseNumericLocation(entry.item.href);
    if (itemLoc == null) continue;
    if (itemLoc <= loc) active = entry;
    else break;
  }
  return active?.key ?? null;
}

function getNoteMarks(
  flat: FlatTocItem[],
  bookId: string | null,
  notes: Highlight[],
): Map<string, string[]> {
  const marks = new Map<string, string[]>();
  if (!bookId || !flat.length) return marks;
  const bookNotes = notes.filter((note) => note.bookId === bookId);

  for (const note of bookNotes) {
    const chapter = findNoteChapter(flat, note);
    if (!chapter) continue;
    const colors = marks.get(chapter.key) ?? [];
    if (!colors.includes(note.color)) colors.push(note.color);
    marks.set(chapter.key, colors);
  }
  return marks;
}

function findNoteChapter(flat: FlatTocItem[], note: Highlight): FlatTocItem | null {
  if (note.tocHref) {
    const exact = flat.find(({ item }) => sameHref(item.href, note.tocHref!));
    if (exact) return exact;
  }

  const noteLoc = parseNumericLocation(note.start);
  if (noteLoc == null) return null;

  let chapter: FlatTocItem | null = null;
  for (const entry of flat) {
    const itemLoc = parseNumericLocation(entry.item.href);
    if (itemLoc == null) continue;
    if (itemLoc <= noteLoc) chapter = entry;
    else break;
  }
  return chapter;
}

function parseNumericLocation(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

function sameHref(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeHref(a) === normalizeHref(b);
}

function normalizeHref(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}
