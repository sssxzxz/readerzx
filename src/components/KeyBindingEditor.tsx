import { useReaderStore } from '@/store/useReaderStore';
import { useState } from 'react';
import { eventToKeyString, prettyBinding } from '@/lib/keys';
import { DEFAULT_BINDINGS, type KeyBindings } from '@shared/types';

const ACTIONS: { key: keyof KeyBindings; label: string; desc: string }[] = [
  { key: 'nextPage', label: '下一页', desc: '默认：空格 / → / PgDn / J' },
  { key: 'prevPage', label: '上一页', desc: '默认：← / PgUp / K' },
  { key: 'toggleAuto', label: '自动翻页 启停', desc: '默认：F9' },
  { key: 'toggleTts', label: '朗读 开始 / 暂停 / 继续', desc: '默认：F6' },
  { key: 'openFile', label: '打开文件', desc: '默认：Ctrl+O' },
  { key: 'toggleSettings', label: '设置面板', desc: '默认：F10' },
  { key: 'toggleToc', label: '目录面板', desc: '默认：F4' },
  { key: 'toggleNotes', label: '笔记 / 高亮面板', desc: '默认：F2' },
  { key: 'toggleImmersive', label: '沉浸阅读模式（仅显示文本）', desc: '默认：F8' },
  { key: 'toggleFullscreen', label: '全屏（窗口）', desc: '默认：F11' },
  { key: 'fontUp', label: '字号增大', desc: '默认：Ctrl+ =' },
  { key: 'fontDown', label: '字号减小', desc: '默认：Ctrl+ -' },
  { key: 'toggleCursor', label: '切换鼠标指针隐藏', desc: '默认可在按键里绑定' },
  { key: 'toggleWheelPaging', label: '开关滚轮翻页', desc: 'TXT/EPUB 等分页模式下生效' },
  { key: 'toggleClickPaging', label: '开关点击翻页', desc: '左半 / 右半区点击' },
  { key: 'togglePageFlipAnimation', label: '开关翻页动画', desc: '分页模式下去下一/上一页时的位移感' },
  {
    key: 'cycleReadingLayout',
    label: '切换版式（分页 ↔ 竖向滚动）',
    desc: 'TXT / EPUB / MOBI / AZW3 / FB2',
  },
  {
    key: 'cycleColumnCount',
    label: '循环分栏（单栏 → 双栏 → 三栏）',
    desc: 'TXT / EPUB 等可重排格式',
  },
  {
    key: 'commitSelectionHighlight',
    label: '将当前选区创建高亮',
    desc: 'TXT / EPUB / MOBI / AZW3 / FB2',
  },
];

export default function KeyBindingEditor() {
  const { book, settings, setSettings } = useReaderStore();
  const [recording, setRecording] = useState<keyof KeyBindings | null>(null);
  const isPdf = book?.format === 'pdf';
  const visibleActions = ACTIONS.filter(
    ({ key }) =>
      !isPdf ||
      (key !== 'cycleReadingLayout' &&
        key !== 'cycleColumnCount' &&
        key !== 'commitSelectionHighlight'),
  ).map((action) => {
    if (!isPdf) return action;
    if (action.key === 'fontUp') return { ...action, label: 'PDF 页面放大' };
    if (action.key === 'fontDown') return { ...action, label: 'PDF 页面缩小' };
    if (action.key === 'toggleWheelPaging') {
      return { ...action, desc: 'PDF 单页翻动模式下生效；连续滚动模式保留自然滚动' };
    }
    return action;
  });

  function startRecord(action: keyof KeyBindings) {
    setRecording(action);
    function handler(e: KeyboardEvent) {
      const k = eventToKeyString(e);
      if (!k) return; // pure modifier
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', handler, true);
      // Add the new combo (avoid duplicates within this action)
      const existing = settings.bindings[action];
      const next = existing.includes(k) ? existing : [...existing, k];
      setSettings({ bindings: { ...settings.bindings, [action]: next } });
      setRecording(null);
    }
    window.addEventListener('keydown', handler, { capture: true, once: false });
  }

  function removeBinding(action: keyof KeyBindings, combo: string) {
    const next = settings.bindings[action].filter((x) => x !== combo);
    setSettings({ bindings: { ...settings.bindings, [action]: next } });
  }

  function resetAll() {
    setSettings({ bindings: DEFAULT_BINDINGS });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold">按键绑定</h4>
        <button
          onClick={resetAll}
          className="text-xs px-2 py-1 rounded bg-muted/20 hover:bg-muted/30"
        >
          恢复默认
        </button>
      </div>
      <div className="text-xs text-muted">
        提示：可为同一动作绑定多个按键。点击 + 录制新按键。
      </div>
      {visibleActions.map(({ key, label, desc }) => (
        <div key={key} className="bg-bg/50 rounded p-2">
          <div className="flex items-center mb-1">
            <div className="flex-1">
              <div className="font-medium text-sm">{label}</div>
              <div className="text-xs text-muted">{desc}</div>
            </div>
            <button
              onClick={() => startRecord(key)}
              className={`text-xs px-2 py-1 rounded ${
                recording === key
                  ? 'bg-accent text-bg animate-pulse'
                  : 'bg-muted/20 hover:bg-muted/30'
              }`}
            >
              {recording === key ? '请按键...' : '+ 添加'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {settings.bindings[key].map((combo) => (
              <span
                key={combo}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-accent/20"
              >
                {prettyBinding(combo)}
                <button
                  className="opacity-50 hover:opacity-100"
                  onClick={() => removeBinding(key, combo)}
                  title="移除此绑定"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
