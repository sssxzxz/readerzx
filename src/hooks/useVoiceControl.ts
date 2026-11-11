import { useCallback, useEffect, useRef, useState } from 'react';
import { isVoiceCommandAllowed, type VoiceCommand, type VoiceEvent } from '@shared/voice';
import { useReaderStore } from '@/store/useReaderStore';
import { playVoiceSuccess, prepareVoiceSound } from '@/lib/voiceSound';

export function useVoiceControl(bookId: string | undefined, execute: (command: VoiceCommand) => Promise<string>, soundEnabled: boolean) {
  const [status, setStatus] = useState<VoiceEvent['state']>('idle');
  const [message, setMessage] = useState('语音控制已关闭');
  const active = useRef(false);
  const session = useRef(0);
  const executeRef = useRef(execute);
  const soundRef = useRef(soundEnabled);
  const busy = useRef(false);
  executeRef.current = execute;
  soundRef.current = soundEnabled;

  const stop = useCallback(async () => {
    active.current = false;
    busy.current = false;
    const id = ++session.current;
    setStatus('idle');
    setMessage('语音控制已关闭');
    try {
      await window.api.stopVoiceControl();
      return true;
    } catch {
      if (id === session.current) {
        setStatus('error');
        setMessage('无法关闭语音控制，请退出阅读器以释放麦克风。');
      }
      return false;
    }
  }, []);

  useEffect(() => {
    active.current = false;
    busy.current = false;
    session.current++;
    setStatus('idle');
    setMessage('语音控制已关闭');
    const unsubscribe = window.api.onVoiceEvent((event) => {
      if (!active.current || event.sessionId !== session.current) return;
      setStatus(event.state);
      if (!busy.current) setMessage(event.message);
      if (event.state === 'error' || event.state === 'idle') active.current = false;
      if (event.state !== 'listening' || !event.command) return;
      // Read synchronously from the store: even results already in transit must
      // obey a newly enabled switch, without waiting for a React render.
      if (!isVoiceCommandAllowed(event.command, useReaderStore.getState().settings.voicePagingOnly)) {
        if (!busy.current) setMessage('仅语音翻页已开启，已忽略此口令');
        return;
      }
      if (event.command === 'voice-stop') {
        void stop().then(ok => { if (ok && soundRef.current) void playVoiceSuccess(); });
        return;
      }
      if (busy.current) return;
      busy.current = true;
      const id = session.current;
      setMessage(`识别：${event.transcript}，执行中…`);
      void executeRef.current(event.command).then(result => {
        if (id !== session.current || !active.current) return;
        setMessage(`已执行：${event.transcript} · ${result}`);
        if (soundRef.current) void playVoiceSuccess();
      }).catch(error => {
        if (id === session.current && active.current) setMessage(`未执行：${event.transcript} · ${error instanceof Error ? error.message : '请重试'}`);
      }).finally(() => {
        if (id === session.current) busy.current = false;
      });
    });
    return () => {
      unsubscribe();
      active.current = false;
      session.current++;
      void window.api.stopVoiceControl().catch(() => {});
    };
  }, [bookId, stop]);

  const toggle = useCallback(() => {
    if (active.current) { stop(); return; }
    if (!bookId) return;
    if (soundRef.current) prepareVoiceSound();
    active.current = true;
    const id = ++session.current;
    setStatus('starting');
    setMessage('正在启动麦克风…');
    void window.api.startVoiceControl(id).catch(() => {
      if (session.current !== id || !active.current) return;
      active.current = false;
      setStatus('error');
      setMessage('无法启动语音控制，请重启阅读器后重试。');
    });
  }, [bookId, stop]);

  return { status, message, toggle, stop, active: status === 'starting' || status === 'listening' };
}
