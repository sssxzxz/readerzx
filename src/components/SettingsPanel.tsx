import { useReaderStore } from '@/store/useReaderStore';
import {
  PRESET_THEMES,
  type ClickAction,
  type ClickActions,
  type DragHighlightActions,
  type DragHighlightAction,
  type ReadingLayout,
  type ThemeId,
  type WheelActions,
} from '@shared/types';
import KeyBindingEditor from './KeyBindingEditor';
import { useEffect, useState } from 'react';

const CLICK_ACTION_OPTIONS: { id: ClickAction; label: string }[] = [
  { id: 'none', label: '无（不响应）' },
  { id: 'prev', label: '上翻页' },
  { id: 'next', label: '下翻页' },
  { id: 'toggleCursor', label: '切换鼠标指针隐身' },
  { id: 'hideCursor', label: '隐藏鼠标指针' },
  { id: 'showCursor', label: '显示鼠标指针' },
  { id: 'toggleAuto', label: '启停自动翻页' },
  { id: 'toggleTts', label: '启停朗读' },
  { id: 'toggleImmersive', label: '切换沉浸模式' },
  { id: 'toggleFullscreen', label: '切换全屏' },
];

const DRAG_ACTION_OPTIONS: { id: DragHighlightAction; label: string }[] = [
  { id: 'none', label: '无动作' },
  { id: 'highlight', label: '创建高亮' },
];

const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'white', name: '白底' },
  { id: 'sepia', name: '米黄' },
  { id: 'green', name: '护眼绿' },
  { id: 'gray', name: '深灰' },
  { id: 'dark', name: '夜间' },
  { id: 'black', name: '纯黑' },
  { id: 'custom', name: '自定义' },
];

const FONTS = [
  { name: '系统默认', value: 'system-ui, -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif' },
  { name: '宋体', value: '"SimSun", "Songti SC", serif' },
  { name: '黑体', value: '"SimHei", "Microsoft YaHei", sans-serif' },
  { name: '楷体', value: '"KaiTi", "STKaiti", serif' },
  { name: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { name: '苹方', value: '"PingFang SC", sans-serif' },
  { name: 'Serif (英文)', value: 'Georgia, "Times New Roman", serif' },
  { name: 'Sans (英文)', value: 'system-ui, sans-serif' },
];

export default function SettingsPanel() {
  const {
    showSettings,
    toggleSettings,
    settings,
    setSettings,
    resetSettings,
    book,
    hasBookSettings,
    saveSettingsForCurrentBook,
    removeSettingsForCurrentBook,
  } =
    useReaderStore();
  const [tab, setTab] = useState<'display' | 'paging' | 'tts' | 'keys'>('display');
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const isPdf = book?.format === 'pdf';

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const loadVoices = () => setTtsVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, []);

  if (!showSettings) return null;

  const panelOpacity = Math.min(1, Math.max(0.25, settings.settingsPanelOpacity ?? 1));

  return (
    <div
      className="absolute inset-0 z-30"
      onClick={() => toggleSettings()}
    >
      <div className="absolute inset-y-0 left-0 right-96 bg-black/40 pointer-events-none" />
      <div
        className="absolute top-12 right-0 bottom-7 w-96 shadow-xl flex flex-col"
        style={{
          backgroundColor: `rgb(var(--reader-panel) / ${panelOpacity})`,
          backdropFilter: panelOpacity < 1 ? 'blur(10px)' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-muted/20 flex items-center">
          <h3 className="font-bold flex-1">设置</h3>
          <label
            className="flex items-center gap-1.5 mr-3 text-xs text-muted"
            title="设置窗口透明度"
          >
            <span className="shrink-0">透明度</span>
            <input
              type="range"
              min={25}
              max={100}
              step={5}
              value={Math.round(panelOpacity * 100)}
              onChange={(event) =>
                setSettings({ settingsPanelOpacity: Number(event.target.value) / 100 })
              }
              className="w-16 accent-[rgb(var(--reader-accent))]"
              aria-label="设置窗口透明度"
            />
            <span className="w-8 text-right tabular-nums">
              {Math.round(panelOpacity * 100)}%
            </span>
          </label>
          <button
            onClick={resetSettings}
            className="text-xs px-2 py-1 rounded bg-muted/20 hover:bg-muted/30 mr-2"
            title="所有设置恢复默认"
          >
            重置
          </button>
          <button onClick={() => toggleSettings()} className="text-muted hover:text-fg">
            ✕
          </button>
        </div>
        <div className="flex border-b border-muted/20">
          {(['display', 'paging', 'tts', 'keys'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm ${
                tab === t ? 'border-b-2 border-accent text-fg' : 'text-muted'
              }`}
            >
              {t === 'display' ? '显示' : t === 'paging' ? '翻页' : t === 'tts' ? '朗读' : '按键'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin p-4 space-y-5">
          {tab === 'display' && (
            <>
              {book && (
                <div className="rounded border border-muted/25 bg-bg/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">
                        {hasBookSettings ? '本书专属阅读配置' : '跟随全局阅读配置'}
                      </div>
                      <div className="text-xs text-muted">
                        {hasBookSettings
                          ? '当前修改只保存到这本书；其他书仍按全局配置。'
                          : isPdf
                            ? '未保存到本书前，PDF 显示和翻页设置会继续作为全局配置生效。'
                            : '未保存到本书前，字体、行距等修改会继续作为全局配置生效。'}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                        hasBookSettings ? 'bg-accent/25 text-fg' : 'bg-muted/20 text-muted'
                      }`}
                    >
                      {hasBookSettings ? '本书' : '全局'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void saveSettingsForCurrentBook()}
                      className="flex-1 px-3 py-1.5 rounded bg-accent text-bg text-sm hover:opacity-90"
                    >
                      保存为本书配置
                    </button>
                    {hasBookSettings && (
                      <button
                        onClick={() => void removeSettingsForCurrentBook()}
                        className="px-3 py-1.5 rounded bg-muted/20 hover:bg-muted/30 text-sm"
                      >
                        改回全局
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isPdf && (
                <>
                  <div className="rounded border border-muted/25 bg-bg/40 p-3 text-xs text-muted">
                    PDF 会保持书籍原来的排版，因此字体、粗细、行距和分栏无法单独修改。这里仅显示真正对 PDF 生效的选项。
                  </div>
                  <div>
                    <label className="font-semibold text-sm flex justify-between mb-2">
                      <span>PDF 页面大小</span>
                      <span className="text-muted">
                        {settings.pdfScaleMode === 'width'
                          ? '适合宽度'
                          : settings.pdfScaleMode === 'page'
                            ? '适合整页'
                            : `${settings.pdfScale}%`}
                      </span>
                    </label>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {([
                        ['width', '适合宽度'],
                        ['page', '适合整页'],
                        ['custom', '自定义'],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          onClick={() =>
                            setSettings(
                              mode === 'custom'
                                ? { pdfScaleMode: mode, pdfScale: settings.pdfScale || 100 }
                                : { pdfScaleMode: mode },
                            )
                          }
                          className={`py-2 rounded border-2 text-xs transition-colors ${
                            settings.pdfScaleMode === mode
                              ? 'border-accent bg-accent/10 text-fg'
                              : 'border-muted/30 hover:border-muted/60 text-muted'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={25}
                      max={500}
                      step={5}
                      value={settings.pdfScale}
                      onChange={(e) =>
                        setSettings({
                          pdfScaleMode: 'custom',
                          pdfScale: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full accent-[rgb(var(--reader-accent))]"
                    />
                    <div className="flex justify-between text-xs text-muted">
                      <span>25%</span>
                      <span>Ctrl+滚轮或顶部 − / + 可缩放</span>
                      <span>500%</span>
                    </div>
                  </div>
                </>
              )}

              {/* Font size */}
              {!isPdf && (
                <>
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="font-semibold text-sm">字体大小（无上限）</label>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-7 h-7 rounded bg-muted/20 hover:bg-muted/30"
                      onClick={() =>
                        setSettings({ fontSize: Math.max(8, settings.fontSize - 2) })
                      }
                    >
                      −
                    </button>
                    <input
                      type="number"
                      className="w-20 px-2 py-1 rounded bg-bg border border-muted/30 text-sm"
                      value={settings.fontSize}
                      min={8}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 8) setSettings({ fontSize: v });
                      }}
                    />
                    <span className="text-xs text-muted">px</span>
                    <button
                      className="w-7 h-7 rounded bg-muted/20 hover:bg-muted/30"
                      onClick={() => setSettings({ fontSize: settings.fontSize + 2 })}
                    >
                      +
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={12}
                  max={200}
                  value={Math.min(200, settings.fontSize)}
                  onChange={(e) => setSettings({ fontSize: parseInt(e.target.value, 10) })}
                  className="w-full accent-[rgb(var(--reader-accent))]"
                />
                <div className="flex justify-between text-xs text-muted">
                  <span>12</span>
                  <span>滑条 12–200，输入框无上限</span>
                  <span>200+</span>
                </div>
                <div className="text-xs text-muted mt-1">
                  快捷键：Ctrl+滚轮 实时调整 · Ctrl++/-
                </div>
              </div>

              {/* Font family */}
              <div>
                <label className="font-semibold text-sm block mb-2">字体</label>
                <select
                  className="w-full px-2 py-1 rounded bg-bg border border-muted/30"
                  value={settings.fontFamily}
                  onChange={(e) => setSettings({ fontFamily: e.target.value })}
                >
                  {FONTS.map((f) => (
                    <option key={f.name} value={f.value}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Font weight */}
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>字体粗细</span>
                  <span className="text-muted">
                    {weightLabel(settings.fontWeight)} ({settings.fontWeight})
                  </span>
                </label>
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {[300, 400, 500, 600, 700].map((w) => (
                    <button
                      key={w}
                      onClick={() => setSettings({ fontWeight: w })}
                      className={`py-1.5 rounded text-xs border transition-colors ${
                        settings.fontWeight === w
                          ? 'border-accent bg-accent/15 text-fg'
                          : 'border-muted/30 hover:bg-muted/15 text-muted'
                      }`}
                      style={{ fontWeight: w }}
                    >
                      {weightLabel(w)}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() =>
                    setSettings({
                      fontWeight: settings.fontWeight >= 700 ? 400 : 700,
                    })
                  }
                  className="w-full py-1 rounded bg-muted/15 hover:bg-muted/25 text-xs"
                >
                  {settings.fontWeight >= 700 ? '取消加粗' : '一键加粗（B）'}
                </button>
              </div>

              {/* Reading layout */}
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>显示模式</span>
                  <span className="text-muted">
                    {settings.readingLayout === 'vertical' ? '上下滚轮阅读' : '分页阅读'}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['paginated', '分页阅读', '单页 / 双页 / 三页翻动'],
                    ['vertical', '上下滚轮阅读', '连续竖向滚动'],
                  ] as Array<[ReadingLayout, string, string]>).map(([id, label, desc]) => (
                    <button
                      key={id}
                      onClick={() => setSettings({ readingLayout: id })}
                      className={`py-2 px-2 rounded border-2 text-sm transition-colors ${
                        settings.readingLayout === id
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-muted/30 hover:border-muted/60 text-muted'
                      }`}
                    >
                      <div>{label}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted mt-1">
                  TXT / EPUB / MOBI / AZW3 / FB2 使用此显示模式；PDF 的上下滚动在下方 PDF 阅读模式中选择。
                </div>
              </div>

              {/* Column count (TXT / EPUB) */}
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>分栏（TXT / EPUB）</span>
                  <span className="text-muted">{settings.columnCount} 列</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => setSettings({ columnCount: n as 1 | 2 | 3 })}
                      className={`py-2 rounded border-2 text-sm transition-colors ${
                        settings.columnCount === n
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-muted/30 hover:border-muted/60 text-muted'
                      }`}
                      title={`强制 ${n} 列`}
                    >
                      <ColumnIcon n={n} />
                      <div className="mt-1 text-xs">
                        {n === 1 ? '单页' : n === 2 ? '双页' : '三页'}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted mt-1">
                  PDF 不受此设置影响（除 PDF 重排文本模式外）
                </div>
              </div>

              {/* Line height */}
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>行间距</span>
                  <span className="text-muted">{settings.lineHeight.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={settings.lineHeight}
                  onChange={(e) =>
                    setSettings({ lineHeight: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[rgb(var(--reader-accent))]"
                />
              </div>
                </>
              )}

              {/* Page margin */}
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>{isPdf ? 'PDF 页面间距' : '页边距'}</span>
                  <span className="text-muted">{settings.pageMargin}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={120}
                  value={settings.pageMargin}
                  onChange={(e) =>
                    setSettings({ pageMargin: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-[rgb(var(--reader-accent))]"
                />
              </div>

              {/* Theme */}
              <div>
                <label className="font-semibold text-sm block mb-2">背景色</label>
                <div className="grid grid-cols-4 gap-2">
                  {THEMES.map((t) => {
                    const colors =
                      t.id === 'custom'
                        ? settings.customTheme
                        : PRESET_THEMES[t.id as Exclude<ThemeId, 'custom'>];
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSettings({ themeId: t.id })}
                        className={`p-2 rounded border-2 ${
                          settings.themeId === t.id
                            ? 'border-accent'
                            : 'border-transparent hover:border-muted/40'
                        }`}
                        style={{ background: `rgb(${colors.bg})`, color: `rgb(${colors.fg})` }}
                      >
                        <div className="text-xs">{t.name}</div>
                        <div className="text-base mt-1">字</div>
                      </button>
                    );
                  })}
                </div>

                {settings.themeId === 'custom' && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <ColorPicker
                      label="背景"
                      rgbStr={settings.customTheme.bg}
                      onChange={(rgb) =>
                        setSettings({
                          customTheme: { ...settings.customTheme, bg: rgb },
                        })
                      }
                    />
                    <ColorPicker
                      label="文字"
                      rgbStr={settings.customTheme.fg}
                      onChange={(rgb) =>
                        setSettings({
                          customTheme: { ...settings.customTheme, fg: rgb },
                        })
                      }
                    />
                    <ColorPicker
                      label="强调色"
                      rgbStr={settings.customTheme.accent}
                      onChange={(rgb) =>
                        setSettings({
                          customTheme: { ...settings.customTheme, accent: rgb },
                        })
                      }
                    />
                    <ColorPicker
                      label="面板"
                      rgbStr={settings.customTheme.panel}
                      onChange={(rgb) =>
                        setSettings({
                          customTheme: { ...settings.customTheme, panel: rgb },
                        })
                      }
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'paging' && (
            <>
              <Toggle
                label="鼠标点击翻页 / 自定义动作"
                desc="点击屏幕左半 / 右半的单击与双击分别可绑定不同动作"
                value={settings.clickPaging}
                onChange={(v) => setSettings({ clickPaging: v })}
              />
              {settings.clickPaging && (
                <ClickActionMatrix
                  value={settings.clickActions}
                  onChange={(v) => setSettings({ clickActions: v })}
                />
              )}
              {!isPdf && (
                <DragHighlightMatrix
                  value={settings.dragHighlightActions}
                  onChange={(v) => setSettings({ dragHighlightActions: v })}
                />
              )}
              {isPdf && (
                <div className="text-xs text-muted rounded border border-muted/25 bg-bg/40 p-3">
                  PDF 可以选择和复制文字，但当前不支持把拖动选择保存为书内高亮。
                </div>
              )}
              <Toggle
                label="鼠标滚轮动作"
                desc="分页阅读时可分别设置上滚 / 下滚；上下滚轮阅读和 PDF 滚动模式保留自然滚动"
                value={settings.wheelPaging}
                onChange={(v) => setSettings({ wheelPaging: v })}
              />
              {settings.wheelPaging && (
                <WheelActionMatrix
                  value={settings.wheelActions}
                  onChange={(v) => setSettings({ wheelActions: v })}
                />
              )}
              <Toggle
                label="翻页动画"
                desc="分页模式下按下一页 / 上一页显示对应方向的位移动画"
                value={settings.pageFlipAnimation}
                onChange={(v) => setSettings({ pageFlipAnimation: v })}
              />
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>自动翻页间隔</span>
                  <span className="text-muted">{settings.autoInterval}s</span>
                </label>
                <input
                  type="range"
                  min={5}
                  max={120}
                  value={settings.autoInterval}
                  onChange={(e) =>
                    setSettings({ autoInterval: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-[rgb(var(--reader-accent))]"
                />
                <div className="text-xs text-muted mt-1">F9 启停自动翻页</div>
              </div>
              {isPdf && <div>
                <label className="font-semibold text-sm block mb-2">PDF 阅读模式</label>
                <select
                  className="w-full px-2 py-1 rounded bg-bg border border-muted/30"
                  value={settings.pdfMode === 'single' ? 'single' : 'scroll'}
                  onChange={(e) =>
                    setSettings({ pdfMode: e.target.value as 'scroll' | 'single' })
                  }
                >
                  <option value="scroll">连续滚动（推荐，类似 Adobe）</option>
                  <option value="single">单页翻动</option>
                </select>
                <div className="text-xs text-muted mt-1">
                  PDF 保持原版式；连续滚动会按可见区域懒加载页面，窗口放大缩小时保留当前位置。Ctrl+滚轮可缩放。
                </div>
              </div>}
            </>
          )}

          {tab === 'tts' && (
            <>
              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>朗读语速</span>
                  <span className="text-muted">{(settings.ttsRate ?? 1).toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={settings.ttsRate ?? 1}
                  onChange={(e) => setSettings({ ttsRate: parseFloat(e.target.value) })}
                  className="w-full accent-[rgb(var(--reader-accent))]"
                />
              </div>

              <div>
                <label className="font-semibold text-sm flex justify-between mb-2">
                  <span>朗读音调</span>
                  <span className="text-muted">{(settings.ttsPitch ?? 1).toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.ttsPitch ?? 1}
                  onChange={(e) => setSettings({ ttsPitch: parseFloat(e.target.value) })}
                  className="w-full accent-[rgb(var(--reader-accent))]"
                />
              </div>

              <div>
                <label className="font-semibold text-sm block mb-2">系统声音</label>
                <select
                  className="w-full px-2 py-1 rounded bg-bg border border-muted/30"
                  value={settings.ttsVoiceURI ?? ''}
                  onChange={(e) =>
                    setSettings({ ttsVoiceURI: e.target.value || undefined })
                  }
                  disabled={!('speechSynthesis' in window)}
                >
                  <option value="">系统默认声音</option>
                  {ttsVoices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} {voice.lang ? `(${voice.lang})` : ''}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-muted mt-1">
                  使用 Windows / Chromium 已安装的系统语音；没有声音时请在系统语音设置里安装中文语音包。
                </div>
              </div>
            </>
          )}

          {tab === 'keys' && <KeyBindingEditor />}
        </div>
      </div>
    </div>
  );
}

function weightLabel(w: number): string {
  if (w <= 300) return '细';
  if (w <= 400) return '常规';
  if (w <= 500) return '中等';
  if (w <= 600) return '半粗';
  return '加粗';
}

function ColumnIcon({ n }: { n: number }) {
  return (
    <div
      className="mx-auto flex gap-0.5 items-stretch"
      style={{ width: 32, height: 18 }}
    >
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="flex-1 border border-current rounded-sm opacity-60"
        />
      ))}
    </div>
  );
}

function Toggle({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center cursor-pointer">
      <div className="flex-1">
        <div className="font-semibold text-sm">{label}</div>
        {desc && <div className="text-xs text-muted">{desc}</div>}
      </div>
      <span
        onClick={() => onChange(!value)}
        className={`relative w-10 h-6 rounded-full transition-colors ${
          value ? 'bg-accent' : 'bg-muted/30'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-bg transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </label>
  );
}

function ClickActionMatrix({
  value,
  onChange,
}: {
  value: ClickActions;
  onChange: (v: ClickActions) => void;
}) {
  const halfRows: Array<{
    label: string;
    keys: [keyof ClickActions, keyof ClickActions];
    sublabels: [string, string];
  }> = [
    { label: '左半区', keys: ['leftSingle', 'leftDouble'], sublabels: ['单击', '双击'] },
    { label: '右半区', keys: ['rightSingle', 'rightDouble'], sublabels: ['单击', '双击'] },
  ];
  const buttonRows: Array<{ label: string; key: keyof ClickActions; desc: string }> = [
    { label: '鼠标右键', key: 'rightButton', desc: '右键拖动选词建立高亮的 TXT 手势不受影响' },
    { label: '滚轮键（中键）', key: 'middleButton', desc: '按下滚轮即触发，自动屏蔽系统的中键自动滚动' },
  ];
  const hasDelay =
    (value.leftDouble !== 'none' && value.leftDouble !== value.leftSingle) ||
    (value.rightDouble !== 'none' && value.rightDouble !== value.rightSingle);

  return (
    <div className="rounded border border-muted/20 p-3 bg-bg/40 space-y-3">
      <div className="text-xs text-muted">
        在文本阅读区点击对应区域时触发的动作。可绑定动作：
        <b> 翻页、鼠标指针、自动翻页、朗读、沉浸、全屏</b>。
      </div>

      <div className="text-xs font-semibold text-fg/80 pt-1">左键 · 半区 / 单双击</div>
      {halfRows.map((row) => (
        <div key={row.label} className="space-y-1.5">
          <div className="font-medium text-sm">{row.label}</div>
          <div className="grid grid-cols-2 gap-2">
            {row.keys.map((k, i) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-xs text-muted">{row.sublabels[i]}</span>
                <select
                  className="px-2 py-1 rounded bg-bg border border-muted/30 text-sm"
                  value={value[k]}
                  onChange={(e) =>
                    onChange({ ...value, [k]: e.target.value as ClickAction })
                  }
                >
                  {CLICK_ACTION_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="text-xs font-semibold text-fg/80 pt-2">其他鼠标按键</div>
      {buttonRows.map((row) => (
        <label key={row.key} className="block space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-sm">{row.label}</span>
          </div>
          <select
            className="w-full px-2 py-1 rounded bg-bg border border-muted/30 text-sm"
            value={value[row.key]}
            onChange={(e) =>
              onChange({ ...value, [row.key]: e.target.value as ClickAction })
            }
          >
            {CLICK_ACTION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="text-xs text-muted">{row.desc}</div>
        </label>
      ))}

      <div
        className={`text-xs ${
          hasDelay ? 'text-amber-500' : 'text-muted'
        }`}
      >
        {hasDelay
          ? '⚠ 当某半区单击与双击动作不同时，左键单击会延迟约 220ms 以判别双击。右键 / 中键无此延迟。'
          : '当前所有半区的左键单击和双击动作一致，单击立刻响应。右键 / 中键始终立即响应。'}
      </div>
    </div>
  );
}

function DragHighlightMatrix({
  value,
  onChange,
}: {
  value: DragHighlightActions;
  onChange: (v: DragHighlightActions) => void;
}) {
  const rows: Array<{ key: keyof DragHighlightActions; label: string; desc: string }> = [
    { key: 'leftButton', label: '左键拖选', desc: 'TXT 中拖动选中文字后的动作' },
    { key: 'rightButton', label: '右键拖选', desc: '保留旧习惯：默认拖选创建高亮' },
  ];

  return (
    <div className="rounded border border-muted/20 p-3 bg-bg/40 space-y-2">
      <div className="text-xs font-semibold text-fg/80">TXT 拖选高亮</div>
      {rows.map((row) => (
        <label key={row.key} className="block space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-sm">{row.label}</span>
            <span className="text-xs text-muted">{row.desc}</span>
          </div>
          <select
            className="w-full px-2 py-1 rounded bg-bg border border-muted/30 text-sm"
            value={value[row.key]}
            onChange={(e) =>
              onChange({ ...value, [row.key]: e.target.value as DragHighlightAction })
            }
          >
            {DRAG_ACTION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function WheelActionMatrix({
  value,
  onChange,
}: {
  value: WheelActions;
  onChange: (v: WheelActions) => void;
}) {
  const rows: Array<{ key: keyof WheelActions; label: string; desc: string }> = [
    { key: 'up', label: '向上滚轮', desc: '默认上翻页' },
    { key: 'down', label: '向下滚轮', desc: '默认下翻页' },
  ];

  return (
    <div className="rounded border border-muted/20 p-3 bg-bg/40 space-y-2">
      <div className="text-xs font-semibold text-fg/80">滚轮方向动作</div>
      {rows.map((row) => (
        <label key={row.key} className="block space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-sm">{row.label}</span>
            <span className="text-xs text-muted">{row.desc}</span>
          </div>
          <select
            className="w-full px-2 py-1 rounded bg-bg border border-muted/30 text-sm"
            value={value[row.key]}
            onChange={(e) =>
              onChange({ ...value, [row.key]: e.target.value as ClickAction })
            }
          >
            {CLICK_ACTION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="text-xs text-muted">
        设为“无”即可让该方向不触发动作；按住 Ctrl 滚轮仍固定用于调整字号。
      </div>
    </div>
  );
}

function ColorPicker({
  label,
  rgbStr,
  onChange,
}: {
  label: string;
  rgbStr: string;
  onChange: (rgbStr: string) => void;
}) {
  const [r, g, b] = rgbStr.split(/\s+/).map((x) => parseInt(x, 10));
  const hex = `#${[r, g, b]
    .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0'))
    .join('')}`;
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          const v = e.target.value.replace('#', '');
          const nr = parseInt(v.slice(0, 2), 16);
          const ng = parseInt(v.slice(2, 4), 16);
          const nb = parseInt(v.slice(4, 6), 16);
          onChange(`${nr} ${ng} ${nb}`);
        }}
        className="w-8 h-8 rounded border border-muted/30"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
