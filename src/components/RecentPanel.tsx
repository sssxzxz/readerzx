import { useReaderStore } from '@/store/useReaderStore';

export default function RecentPanel() {
  const { showRecent, toggleRecent, recent, openByPath } = useReaderStore();
  if (!showRecent) return null;
  return (
    <div
      className="absolute inset-0 z-30 bg-black/40"
      onClick={() => toggleRecent()}
    >
      <div
        className="absolute top-12 left-0 bottom-7 w-96 bg-panel shadow-xl overflow-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 sticky top-0 bg-panel border-b border-muted/20 flex items-center">
          <h3 className="font-bold flex-1">最近阅读</h3>
          <button
            onClick={() => toggleRecent()}
            className="text-muted hover:text-fg"
          >
            ✕
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="p-4 text-muted text-sm">无记录</div>
        ) : (
          <ul className="py-2">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => {
                    openByPath(r.path);
                    toggleRecent();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-muted/15 flex items-center gap-2"
                >
                  <span className="text-xs uppercase px-1.5 py-0.5 rounded bg-accent/20">
                    {r.format}
                  </span>
                  <span className="flex-1 truncate text-sm">{r.name}</span>
                  <span className="text-xs text-muted">
                    {Math.round((r.percent ?? 0) * 100)}%
                  </span>
                </button>
                <div className="text-xs text-muted px-3 pb-2 truncate">{r.path}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
