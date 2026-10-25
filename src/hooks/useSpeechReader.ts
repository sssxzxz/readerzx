import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { ReaderSettings } from '@shared/types';
import type { RendererHandle, TtsSnapshot } from '@/renderers/FoliateRenderer';

export type TtsStatus = 'idle' | 'speaking' | 'paused' | 'loading' | 'unavailable';

interface UseSpeechReaderOptions {
  rendererRef: RefObject<RendererHandle>;
  settings: ReaderSettings;
  bookId?: string;
  turnPage: (dir: 'next' | 'prev') => void;
}

export interface SpeechReaderControls {
  status: TtsStatus;
  voices: SpeechSynthesisVoice[];
  message: string | null;
  toggle: () => void;
  stop: () => void;
}

const MAX_CHUNK_CHARS = 1600;

export function useSpeechReader({
  rendererRef,
  settings,
  bookId,
  turnPage,
}: UseSpeechReaderOptions): SpeechReaderControls {
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';
  const [status, setStatus] = useState<TtsStatus>(supported ? 'idle' : 'unavailable');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const statusRef = useRef<TtsStatus>(status);
  const sequenceRef = useRef(0);
  const settingsRef = useRef(settings);

  statusRef.current = status;
  settingsRef.current = settings;

  useEffect(() => {
    if (!supported) {
      setStatus('unavailable');
      setMessage('当前系统没有可用的朗读引擎');
      return;
    }

    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, [supported]);

  const stop = useCallback(() => {
    sequenceRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setStatus(supported ? 'idle' : 'unavailable');
    setMessage(null);
  }, [supported]);

  useEffect(() => stop, [bookId, stop]);

  const speakSnapshot = useCallback(
    async (snapshot: TtsSnapshot, seq: number): Promise<boolean> => {
      const text = cleanSpeechText(snapshot.text);
      if (!text) return false;
      for (const chunk of splitSpeechText(text)) {
        if (seq !== sequenceRef.current) return false;
        const ok = await speakChunk(chunk, settingsRef.current, voices, seq, sequenceRef);
        if (!ok || seq !== sequenceRef.current) return false;
      }
      return true;
    },
    [voices],
  );

  const readContinuously = useCallback(async () => {
    if (!supported) {
      setStatus('unavailable');
      setMessage('当前系统没有可用的朗读引擎');
      return;
    }
    const seq = sequenceRef.current + 1;
    sequenceRef.current = seq;
    window.speechSynthesis.cancel();
    setMessage(null);

    let previousLocation: string | null = null;
    let emptySkips = 0;

    while (seq === sequenceRef.current) {
      setStatus('loading');
      const snapshot = await rendererRef.current?.getTtsSnapshot?.();
      if (seq !== sequenceRef.current) return;

      if (!snapshot) {
        setStatus('idle');
        setMessage('当前页面暂时无法朗读');
        return;
      }

      if (previousLocation && snapshot.location === previousLocation) {
        setStatus('idle');
        setMessage('已读到当前位置的末尾');
        return;
      }

      const hasText = cleanSpeechText(snapshot.text).length > 0;
      if (!hasText) {
        if (!snapshot.hasNext || emptySkips >= 3) {
          setStatus('idle');
          setMessage('当前内容没有可朗读文本');
          return;
        }
        emptySkips += 1;
        previousLocation = snapshot.location;
        turnPage('next');
        await delay(700);
        continue;
      }

      emptySkips = 0;
      setStatus('speaking');
      const finished = await speakSnapshot(snapshot, seq);
      if (!finished || seq !== sequenceRef.current) return;

      if (!snapshot.hasNext) {
        setStatus('idle');
        setMessage('已朗读完当前书籍');
        return;
      }

      previousLocation = snapshot.location;
      turnPage('next');
      await delay(750);
    }
  }, [rendererRef, speakSnapshot, supported, turnPage]);

  const toggle = useCallback(() => {
    if (!supported) {
      setStatus('unavailable');
      setMessage('当前系统没有可用的朗读引擎');
      return;
    }
    const synth = window.speechSynthesis;
    if (statusRef.current === 'speaking') {
      synth.pause();
      setStatus('paused');
      return;
    }
    if (statusRef.current === 'paused') {
      synth.resume();
      setStatus('speaking');
      return;
    }
    if (statusRef.current === 'loading') {
      stop();
      return;
    }
    void readContinuously();
  }, [readContinuously, stop, supported]);

  return {
    status,
    voices,
    message,
    toggle,
    stop,
  };
}

function speakChunk(
  text: string,
  settings: ReaderSettings,
  voices: SpeechSynthesisVoice[],
  seq: number,
  sequenceRef: MutableRefObject<number>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.find((v) => v.voiceURI === settings.ttsVoiceURI);
    if (voice) utterance.voice = voice;
    utterance.rate = clamp(settings.ttsRate ?? 1, 0.5, 2);
    utterance.pitch = clamp(settings.ttsPitch ?? 1, 0, 2);
    utterance.onend = () => resolve(seq === sequenceRef.current);
    utterance.onerror = () => resolve(false);
    window.speechSynthesis.speak(utterance);
  });
}

function splitSpeechText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK_CHARS) {
    const slice = remaining.slice(0, MAX_CHUNK_CHARS);
    const boundary = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('.'),
      slice.lastIndexOf('!'),
      slice.lastIndexOf('?'),
      slice.lastIndexOf('\n'),
    );
    const end = boundary > 300 ? boundary + 1 : MAX_CHUNK_CHARS;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks;
}

function cleanSpeechText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
