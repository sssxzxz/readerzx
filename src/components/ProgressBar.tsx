import { useReaderStore } from '@/store/useReaderStore';

export default function ProgressBar({ onSeek }: { onSeek?: (percent: number) => void }) {
  const { progress, book } = useReaderStore();
  if (!book) return null;
  const pct = Math.round(progress * 100);
  return (
    <div className="h-7 px-3 flex items-center gap-3 bg-panel/80 border-t border-muted/20 text-xs text-muted">
      <div className="relative flex-1 h-4 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 bg-muted/20 rounded-full overflow-hidden pointer-events-none">
          <div
            className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => onSeek?.(parseInt(e.target.value, 10) / 1000)}
          className="reader-progress-slider relative z-10 w-full h-4 opacity-0 cursor-pointer"
          title="拖动定位阅读进度"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent shadow pointer-events-none"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
      <div className="w-12 text-right">{pct}%</div>
    </div>
  );
}
