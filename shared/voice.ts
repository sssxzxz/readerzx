export type VoiceDirection = 'next' | 'prev';
export const VOICE_COMMANDS = {
  '下一页': 'next', '上一页': 'prev', '上翻': 'prev', '下翻': 'next',
  '放大': 'zoom-in', '字大一号': 'zoom-in', '缩小': 'zoom-out', '字小一号': 'zoom-out',
  '开始自动翻页': 'auto-start', '停止自动翻页': 'auto-stop',
  '进入全屏': 'fullscreen-enter', '全屏模式': 'fullscreen-enter', '打开全屏': 'fullscreen-enter', '全屏': 'fullscreen-enter',
  '退出全屏': 'fullscreen-exit', '普通模式': 'fullscreen-exit', '关闭全屏': 'fullscreen-exit', '退全': 'fullscreen-exit',
  '关闭语音控制': 'voice-stop',
} as const;
export type VoiceCommand = typeof VOICE_COMMANDS[keyof typeof VOICE_COMMANDS];
export const isVoiceCommandAllowed = (command: VoiceCommand, pagingOnly: boolean): boolean =>
  !pagingOnly || command === 'next' || command === 'prev';
export const VOICE_PAGING_HELP = '仅语音翻页：下一页 / 下翻、上一页 / 上翻。其他口令不执行；点击麦克风按钮可关闭监听。';
export const isVoiceCommand = (value: string): value is VoiceCommand =>
  Object.values(VOICE_COMMANDS).some(command => command === value);
export type VoiceState = 'idle' | 'starting' | 'listening' | 'error';
export type VoiceEvent = {
  sessionId: number;
  state: VoiceState;
  message: string;
  direction?: VoiceDirection;
  command?: VoiceCommand;
  transcript?: string;
};

export const VOICE_HELP = '口令：下一页 / 下翻、上一页 / 上翻、放大 / 字大一号、缩小 / 字小一号、开始自动翻页、停止自动翻页；进入全屏：进入全屏 / 全屏模式 / 打开全屏 / 全屏；退出全屏：退出全屏 / 普通模式 / 关闭全屏 / 退全；关闭语音控制';
