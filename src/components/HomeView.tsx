import { useMemo, useState } from 'react';
import { useReaderStore } from '@/store/useReaderStore';
import type { BookFormat, RecentBook } from '@shared/types';

const FORMAT_OPTIONS: Array<'all' | BookFormat> = [
  'all',
  'epub',
  'mobi',
  'azw3',
  'fb2',
  'pdf',
  'txt',
];

export default function HomeView() {
  const { openByDialog, openByPath, removeFromShelf, recent, loading, error, setError } =
    useReaderStore();
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<'all' | BookFormat>('all');

  const sortedBooks = useMemo(
    () => [...recent].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
    [recent],
  );
  const activeBook = sortedBooks[0] ?? null;
  const filteredBooks = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return sortedBooks.filter((book) => {
      if (format !== 'all' && book.format !== format) return false;
      if (!q) return true;
      return (
        book.name.toLocaleLowerCase().includes(q) ||
        book.path.toLocaleLowerCase().includes(q)
      );
    });
  }, [format, query, sortedBooks]);

  return (
    <main
      className="w-full h-full bg-bg text-fg overflow-hidden relative"
      aria-busy={loading}
    >
      <div className="h-full flex flex-col px-8 py-6 gap-5">
        <header className="flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-normal">书架</h1>
            <div className="text-sm text-muted mt-1">
              {recent.length > 0 ? `${recent.length} 本书` : '还没有添加书籍'}
            </div>
          </div>
          <button
            onClick={() => openByDialog()}
            disabled={loading}
            className="px-4 h-10 rounded-md bg-accent text-bg font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
          >
            添加书籍
          </button>
        </header>

        {activeBook && (
          <section className="shrink-0 grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-center border-y border-muted/20 py-4">
            <div className="min-w-0">
              <div className="text-xs text-muted mb-1">继续阅读</div>
              <button
                onClick={() => openByPath(activeBook.path)}
                disabled={loading}
                className="block max-w-full text-left text-xl font-semibold truncate hover:text-accent"
                title={activeBook.name}
              >
                {activeBook.name}
              </button>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                <span className="uppercase">{activeBook.format}</span>
                <span>{Math.round((activeBook.percent ?? 0) * 100)}%</span>
                <span className="truncate">{formatDate(activeBook.lastOpenedAt)}</span>
              </div>
            </div>
            <button
              onClick={() => openByPath(activeBook.path)}
              disabled={loading}
              className="px-4 h-9 rounded-md bg-panel hover:bg-panel/70 disabled:opacity-50 text-sm"
            >
              打开
            </button>
          </section>
        )}

        <div className="shrink-0 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书名或路径"
            className="h-10 min-w-[240px] flex-1 rounded-md bg-panel px-3 outline-none border border-muted/20 focus:border-accent"
          />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as 'all' | BookFormat)}
            className="h-10 rounded-md bg-panel px-3 outline-none border border-muted/20 focus:border-accent"
          >
            {FORMAT_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item === 'all' ? '全部格式' : item.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <section className="min-h-0 flex-1 overflow-auto scrollbar-thin pr-1">
          {filteredBooks.length === 0 ? (
            <EmptyShelf hasBooks={recent.length > 0} onOpen={openByDialog} disabled={loading} />
          ) : (
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] pb-2">
              {filteredBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  disabled={loading}
                  onOpen={() => openByPath(book.path)}
                  onRemove={() => removeFromShelf(book.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      {(loading || error) && (
        <div className="absolute inset-0 z-20 bg-black/35 flex items-center justify-center">
          <div className="min-w-64 max-w-sm rounded-md bg-panel px-5 py-4 shadow-xl border border-muted/20 text-center">
            {loading ? (
              <>
                <div
                  className="mx-auto mb-3 h-7 w-7 rounded-full border-2 border-muted/30 border-t-accent animate-spin"
                  aria-hidden
                />
                <div className="font-medium">正在打开书籍…</div>
                <div className="mt-1 text-xs text-muted">较大的 TXT 会直接恢复到上次阅读位置</div>
              </>
            ) : (
              <>
                <div className="font-medium text-red-500">无法打开书籍</div>
                <div className="mt-1 text-sm text-muted">{error}</div>
                <button
                  onClick={() => setError(null)}
                  className="mt-3 h-8 px-4 rounded-md bg-accent text-bg text-sm"
                >
                  关闭
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function BookCard({
  book,
  onOpen,
  onRemove,
  disabled,
}: {
  book: RecentBook;
  onOpen: () => void;
  onRemove: () => Promise<void>;
  disabled: boolean;
}) {
  const percent = Math.max(0, Math.min(100, Math.round((book.percent ?? 0) * 100)));
  const removeBook = async () => {
    const ok = window.confirm(`从书架移除《${book.name}》？\n\n不会删除磁盘上的原始文件。`);
    if (!ok) return;
    await onRemove();
  };

  return (
    <article
      className="group rounded-md bg-panel hover:bg-panel/70 border border-muted/15 overflow-hidden min-h-[240px] flex flex-col"
      title={book.path}
    >
      <button onClick={onOpen} disabled={disabled} className="text-left block disabled:opacity-60">
        <div
          className="h-28 px-4 py-3 flex flex-col justify-between"
          style={{ background: coverGradient(book.format) }}
        >
          <div className="text-xs uppercase tracking-wide text-bg/80">{book.format}</div>
          <div className="text-bg font-semibold leading-tight line-clamp-3">{book.name}</div>
        </div>
      </button>
      <div className="p-3 flex-1 flex flex-col gap-2 min-w-0">
        <button
          onClick={onOpen}
          disabled={disabled}
          className="text-left font-medium leading-snug line-clamp-2 group-hover:text-accent"
        >
          {book.name}
        </button>
        <div className="text-xs text-muted truncate">{book.path}</div>
        <div className="mt-auto">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>{percent}%</span>
            <span>{formatDate(book.lastOpenedAt)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onOpen}
              disabled={disabled}
              className="h-8 px-3 rounded-md bg-accent text-bg text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              打开
            </button>
            <button
              onClick={() => void removeBook()}
              disabled={disabled}
              className="h-8 px-3 rounded-md bg-bg/40 text-xs text-muted hover:text-fg hover:bg-bg/70 disabled:opacity-50"
            >
              移出书架
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyShelf({
  hasBooks,
  onOpen,
  disabled,
}: {
  hasBooks: boolean;
  onOpen: () => void;
  disabled: boolean;
}) {
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center border border-dashed border-muted/30 rounded-md">
      <div className="text-center px-4">
        <div className="text-lg font-medium mb-2">
          {hasBooks ? '没有匹配的书籍' : '书架还是空的'}
        </div>
        <div className="text-sm text-muted mb-4">
          {hasBooks ? '换个关键词或格式筛选试试' : '添加一本书后，它会留在这里方便下次继续阅读'}
        </div>
        {!hasBooks && (
          <button
            onClick={onOpen}
            disabled={disabled}
            className="px-4 h-10 rounded-md bg-accent text-bg font-medium hover:opacity-90 disabled:opacity-50"
          >
            添加第一本书
          </button>
        )}
      </div>
    </div>
  );
}

function formatDate(value: number): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '今天';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function coverGradient(format: BookFormat): string {
  switch (format) {
    case 'epub':
      return 'linear-gradient(135deg, rgb(168 92 72), rgb(210 150 92))';
    case 'mobi':
    case 'azw3':
      return 'linear-gradient(135deg, rgb(82 102 132), rgb(118 153 177))';
    case 'fb2':
      return 'linear-gradient(135deg, rgb(96 122 84), rgb(154 176 112))';
    case 'pdf':
      return 'linear-gradient(135deg, rgb(146 66 66), rgb(204 94 94))';
    case 'txt':
    default:
      return 'linear-gradient(135deg, rgb(90 90 90), rgb(150 150 140))';
  }
}
