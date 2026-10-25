import { useReaderStore } from '@/store/useReaderStore';
import { HIGHLIGHT_COLORS, type Highlight } from '@shared/types';

interface Props {
  /** Called when a highlight is clicked — typically jumps the renderer to it. */
  onJump: (h: Highlight) => void;
}

export default function NotesPanel({ onJump }: Props) {
  const { showNotes, toggleNotes, notes, book, removeNote, updateNote, clearNotes } =
    useReaderStore();
  if (!showNotes) return null;

  const bookNotes = book ? notes.filter((n) => n.bookId === book.id) : [];
  // Newest first
  const sorted = [...bookNotes].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div
      className="absolute inset-0 z-30 bg-black/40"
      onClick={() => toggleNotes()}
    >
      <div
        className="absolute top-12 left-0 bottom-7 w-96 bg-panel shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 sticky top-0 bg-panel border-b border-muted/20 flex items-center">
          <h3 className="font-bold flex-1">笔记 / 高亮</h3>
          <span className="text-xs text-muted mr-2">{sorted.length} 条</span>
          {sorted.length > 0 && (
            <button
              onClick={() => {
                if (confirm('确定清空本书的所有高亮和笔记吗？')) clearNotes();
              }}
              className="text-xs px-2 py-1 rounded bg-muted/20 hover:bg-muted/30 mr-2"
              title="清空本书所有笔记"
            >
              清空
            </button>
          )}
          <button
            onClick={() => toggleNotes()}
            className="text-muted hover:text-fg"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin">
          {sorted.length === 0 ? (
            <div className="p-6 text-sm text-muted leading-relaxed">
              <div className="font-semibold mb-2">还没有笔记</div>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  EPUB / MOBI / AZW3 / FB2：直接<b>左键拖动选中文字</b>即可创建荧光笔高亮。
                </li>
                <li>
                  TXT：用<b>鼠标右键按住拖动</b>选中文字即可创建。
                </li>
                <li>松开后会弹出小工具栏可换色或删除；点击高亮可再次唤出。</li>
              </ul>
              <div className="mt-3 text-xs opacity-70">
                PDF 暂不支持文本高亮（PDF 内部为图像化排版）。
              </div>
            </div>
          ) : (
            <ul className="py-1">
              {sorted.map((h) => (
                <li
                  key={h.id}
                  className="px-3 py-2 border-b border-muted/10 hover:bg-muted/10 cursor-pointer group"
                  onClick={() => {
                    onJump(h);
                    toggleNotes();
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1.5 w-3 h-3 rounded-full shrink-0 border border-black/10"
                      style={{ background: h.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm leading-snug"
                        style={{
                          background: h.color,
                          padding: '0.05em 0.2em',
                          borderRadius: 3,
                          display: 'inline',
                        }}
                      >
                        {h.text || '(无内容)'}
                      </div>
                      <div className="mt-1 flex items-center gap-1 opacity-70 text-[11px] text-muted">
                        <span>{new Date(h.createdAt).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNote(h.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 text-sm shrink-0"
                      title="删除此高亮"
                    >
                      ✕
                    </button>
                  </div>
                  {/* Color picker row (subtle) */}
                  <div
                    className="mt-1.5 ml-5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {HIGHLIGHT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => updateNote(h.id, { color: c.color })}
                        title={c.label}
                        className={`w-4 h-4 rounded border ${
                          h.color === c.color
                            ? 'border-fg'
                            : 'border-black/10 hover:border-fg/60'
                        }`}
                        style={{ background: c.color }}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
