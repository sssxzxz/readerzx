import { FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import type { SearchResult } from '@shared/types';
import type { RendererHandle } from '@/renderers/FoliateRenderer';

interface Props {
  renderer: RefObject<RendererHandle>;
  onClose: () => void;
}

export default function SearchPanel({ renderer, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('输入关键词搜索当前书籍内容');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) move(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function runSearch(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults([]);
      setActiveIndex(0);
      setMessage('输入关键词搜索当前书籍内容');
      return;
    }
    const search = renderer.current?.search;
    if (!search) {
      setMessage('当前格式暂不支持全文搜索');
      return;
    }
    setSearching(true);
    setMessage('正在搜索...');
    try {
      const found = await search(q);
      setResults(found);
      setActiveIndex(0);
      setMessage(found.length ? `找到 ${found.length} 条结果` : '没有找到匹配内容');
      if (found[0]) jumpTo(found[0]);
    } catch (err: any) {
      setMessage(`搜索失败：${err?.message ?? err}`);
    } finally {
      setSearching(false);
    }
  }

  function jumpTo(result: SearchResult) {
    const handle = renderer.current;
    if (!handle) return;
    if (handle.goToSearchResult) handle.goToSearchResult(result);
    else handle.goTo(result.location);
  }

  function move(delta: number) {
    if (!results.length) return;
    const next = (activeIndex + delta + results.length) % results.length;
    setActiveIndex(next);
    jumpTo(results[next]);
  }

  return (
    <div className="absolute top-14 right-4 z-40 w-[420px] max-w-[calc(100vw-2rem)] bg-panel border border-muted/25 shadow-xl rounded-md overflow-hidden">
      <form onSubmit={runSearch} className="p-3 flex gap-2 border-b border-muted/20">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1.5 rounded bg-bg border border-muted/30 text-sm"
          placeholder="搜索本书内容"
        />
        <button
          type="submit"
          disabled={searching}
          className="px-3 py-1.5 rounded bg-accent text-bg text-sm disabled:opacity-60"
        >
          搜索
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-8 rounded hover:bg-muted/20 text-muted hover:text-fg"
          title="关闭"
        >
          x
        </button>
      </form>

      <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted border-b border-muted/20">
        <span className="flex-1 truncate">{message}</span>
        <button
          onClick={() => move(-1)}
          disabled={!results.length}
          className="px-2 py-1 rounded bg-muted/15 hover:bg-muted/25 disabled:opacity-40"
        >
          上一条
        </button>
        <button
          onClick={() => move(1)}
          disabled={!results.length}
          className="px-2 py-1 rounded bg-muted/15 hover:bg-muted/25 disabled:opacity-40"
        >
          下一条
        </button>
      </div>

      {results.length > 0 && (
        <div className="max-h-80 overflow-auto scrollbar-thin">
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => {
                setActiveIndex(i);
                jumpTo(r);
              }}
              className={`w-full text-left px-3 py-2 border-b border-muted/10 hover:bg-muted/15 ${
                i === activeIndex ? 'bg-accent/12' : ''
              }`}
            >
              <div className="flex items-center gap-2 text-[11px] text-muted mb-1">
                <span>{i + 1}</span>
                {r.label && <span className="truncate">{r.label}</span>}
                {r.percent != null && <span className="ml-auto">{Math.round(r.percent * 100)}%</span>}
              </div>
              <div className="text-sm leading-snug line-clamp-2">{r.excerpt}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
