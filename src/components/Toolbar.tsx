import { useReaderStore } from '@/store/useReaderStore';
import type { TtsStatus } from '@/hooks/useSpeechReader';

interface ToolbarProps {
  onSearch?: () => void;
  ttsStatus?: TtsStatus;
  ttsMessage?: string | null;
  onToggleTts?: () => void;
  onStopTts?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
}

export default function Toolbar({
  onSearch,
  ttsStatus = 'idle',
  ttsMessage,
  onToggleTts,
  onStopTts,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: ToolbarProps) {
  const {
    book,
    closeBook,
    openByDialog,
    toggleSettings,
    toggleToc,
    toggleAuto,
    toggleNotes,
    toggleImmersive,
    toggleFullscreen,
    fullscreen,
    autoOn,
    settings,
    setSettings,
    toggleRecent,
    notes,
  } = useReaderStore();

  if (!book) return null;

  return (
    <div className="h-12 flex items-center px-3 gap-2 bg-panel/80 border-b border-muted/20 backdrop-blur z-20">
      <button
        onClick={() => closeBook()}
        title="返回首页"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        ← 首页
      </button>
      <button
        onClick={() => openByDialog()}
        title="打开 (Ctrl+O)"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        打开
      </button>
      <button
        onClick={() => toggleRecent()}
        title="最近阅读"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        最近
      </button>
      <button
        onClick={() => toggleToc()}
        title="目录 (F4)"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        目录
      </button>
      <button
        onClick={() => toggleNotes()}
        title={`笔记 / 高亮 (F2)${notes.length ? ` · ${notes.length}` : ''}`}
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm flex items-center gap-1"
      >
        笔记
        {book && notes.filter((n) => n.bookId === book.id).length > 0 && (
          <span className="text-[10px] px-1 rounded bg-accent/30">
            {notes.filter((n) => n.bookId === book.id).length}
          </span>
        )}
      </button>
      <button
        onClick={() => onSearch?.()}
        title="搜索 / 定位"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        搜索
      </button>
      <div className="flex-1 truncate text-center text-sm text-muted px-2 flex items-center justify-center gap-2 min-w-0">
        <span className="uppercase px-1.5 py-0.5 rounded bg-accent/20 text-xs shrink-0">
          {book.format}
        </span>
        {(book.format === 'txt' ||
          book.format === 'epub' ||
          book.format === 'mobi' ||
          book.format === 'azw3' ||
          book.format === 'fb2') &&
          settings.readingLayout === 'vertical' && (
            <span
              className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-muted/25 text-muted"
              title="竖向连续滚动；可在设置或按键绑定中切回分页"
            >
              竖滚
            </span>
          )}
        <span className="truncate">{book.name}</span>
      </div>
      {book.format === 'pdf' ? (
        <div className="flex items-center gap-1 mr-2">
          <button
            onClick={onZoomOut}
            className="w-7 h-7 rounded hover:bg-muted/20"
            title="缩小 PDF 页面"
          >
            −
          </button>
          <button
            onClick={onResetZoom}
            className="min-w-12 h-7 px-1 rounded hover:bg-muted/20 text-xs text-muted"
            title="恢复适合宽度"
          >
            {settings.pdfScaleMode === 'width'
              ? '适宽'
              : settings.pdfScaleMode === 'page'
                ? '整页'
                : `${settings.pdfScale}%`}
          </button>
          <button
            onClick={onZoomIn}
            className="w-7 h-7 rounded hover:bg-muted/20"
            title="放大 PDF 页面"
          >
            +
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 mr-2">
          <button
            onClick={() => setSettings({ fontSize: Math.max(8, settings.fontSize - 2) })}
            className="w-7 h-7 rounded hover:bg-muted/20"
            title="缩小字体"
          >
            A−
          </button>
          <span className="text-xs text-muted w-10 text-center">{settings.fontSize}</span>
          <button
            onClick={() => setSettings({ fontSize: settings.fontSize + 2 })}
            className="w-7 h-7 rounded hover:bg-muted/20"
            title="放大字体"
          >
            A+
          </button>
          <button
            onClick={() =>
              setSettings({ fontWeight: settings.fontWeight >= 700 ? 400 : 700 })
            }
            className={`w-7 h-7 rounded text-sm font-bold ${
              settings.fontWeight >= 700 ? 'bg-accent text-bg' : 'hover:bg-muted/20'
            }`}
            title="加粗 / 取消加粗"
          >
            B
          </button>
        </div>
      )}
      {/* Column count quick switch (TXT / EPUB) */}
      {(book.format === 'txt' ||
        book.format === 'epub' ||
        book.format === 'mobi' ||
        book.format === 'azw3' ||
        book.format === 'fb2') && (
        <div className="flex items-center mr-2 rounded overflow-hidden border border-muted/30">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setSettings({ columnCount: n as 1 | 2 | 3 })}
              className={`w-7 h-7 text-xs ${
                settings.columnCount === n
                  ? 'bg-accent text-bg'
                  : 'hover:bg-muted/20 text-muted'
              }`}
              title={`${n === 1 ? '单' : n === 2 ? '双' : '三'}页`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => toggleAuto()}
        title="自动翻页 (F9)"
        className={`px-2 py-1 rounded text-sm ${
          autoOn ? 'bg-accent text-bg' : 'hover:bg-muted/20'
        }`}
      >
        {autoOn ? '⏸ 暂停' : '▶ 自动'}
      </button>
      <button
        onClick={() => onToggleTts?.()}
        title={ttsMessage ?? '朗读 (F6)'}
        className={`px-2 py-1 rounded text-sm ${
          ttsStatus === 'speaking' || ttsStatus === 'loading'
            ? 'bg-accent text-bg'
            : ttsStatus === 'paused'
              ? 'bg-muted/30'
              : 'hover:bg-muted/20'
        }`}
        disabled={ttsStatus === 'unavailable'}
      >
        {ttsStatus === 'loading'
          ? '朗读中...'
          : ttsStatus === 'speaking'
            ? '⏸ 朗读'
            : ttsStatus === 'paused'
              ? '▶ 继续'
              : '朗读'}
      </button>
      {(ttsStatus === 'speaking' || ttsStatus === 'paused' || ttsStatus === 'loading') && (
        <button
          onClick={() => onStopTts?.()}
          title="停止朗读"
          className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
        >
          停止
        </button>
      )}
      <button
        onClick={() => toggleImmersive()}
        title="沉浸阅读模式：隐藏所有界面 (F8)"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        沉浸
      </button>
      <button
        onClick={() => void toggleFullscreen()}
        title={fullscreen ? '退出全屏 (F11)' : '全屏 (F11)'}
        className={`px-2 py-1 rounded text-sm ${
          fullscreen ? 'bg-accent text-bg' : 'hover:bg-muted/20'
        }`}
      >
        {fullscreen ? '⊠ 退出' : '⛶ 全屏'}
      </button>
      <button
        onClick={() => toggleSettings()}
        title="设置 (F10)"
        className="px-2 py-1 rounded hover:bg-muted/20 text-sm"
      >
        设置
      </button>
    </div>
  );
}
