import { VOICE_HELP, VOICE_PAGING_HELP, type VoiceState } from '@shared/voice';

export default function VoiceControlButton({ status, message, onToggle, pagingOnly }: {
  status: VoiceState;
  message: string;
  onToggle: () => void;
  pagingOnly: boolean;
}) {
  const active = status === 'starting' || status === 'listening';
  const label = active ? '关闭语音控制' : '开启语音控制';
  return (
    <button
      type="button"
      data-voice-state={status}
      aria-label={label}
      aria-pressed={active}
      title={`${label}\n${message}\n${pagingOnly ? VOICE_PAGING_HELP : VOICE_HELP}`}
      onClick={onToggle}
      className={`relative w-8 h-8 shrink-0 inline-flex items-center justify-center rounded ${active ? 'bg-accent/20 text-accent' : 'hover:bg-muted/20'}`}
    >
      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      </svg>
      {status !== 'idle' && <span aria-hidden="true" className={`absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full ${status === 'error' ? 'bg-red-500' : status === 'starting' ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />}
      <span role="status" className="sr-only">{status === 'listening' ? '麦克风监听中 · ' : ''}{message}</span>
    </button>
  );
}
