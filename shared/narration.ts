import type { BookFormat } from './types';

export interface VoiceProfile {
  id: string;
  name: string;
  engine: 'zipvoice';
  model: string;
  referenceText: string;
  referenceFile: string;
  fingerprint: string;
  createdAt: number;
}
export interface NarrationRuntime { pythonPath: string; dependencyPath: string; modelRoot: string; ffmpegPath: string }
export interface SpeechPosition { section: number; offset: number; location: string; end?: number }
export interface NarrationSection { section: number; text: string; location: string }
export interface NarrationText { sections: NarrationSection[]; warnings: string[] }
export interface NarrationBookInput extends NarrationText {
  bookId: string; bookName: string; format: BookFormat;
  /** SHA-256 of book bytes, distinct from reader progress ID. */
  contentHash: string;
}
export interface NarrationSegment extends SpeechPosition {
  id: number; end: number; text: string;
  state: 'pending' | 'ready' | 'failed';
  duration?: number; bytes?: number; error?: string;
}
export type NarrationJobStatus = 'paused' | 'queued' | 'generating' | 'complete' | 'error';
export interface NarrationJob {
  synthesisKey: string;
  id: string; bookHash: string; bookId: string; bookName: string; format: BookFormat;
  voice: VoiceProfile; createdAt: number; status: NarrationJobStatus;
  segments: NarrationSegment[]; warnings: string[];
  priority: number[]; activeSegment?: number; error?: string;
  elapsedMs: number;
}
export interface NarrationJobSummary extends Omit<NarrationJob, 'segments' | 'priority'> {
  total: number; ready: number; failed: number; audioSeconds: number; bytes: number;
}
export interface NarrationState {
  voices: VoiceProfile[]; jobs: NarrationJobSummary[];
  runtime: NarrationRuntime; ready: boolean; busy: boolean; message: string;
}
export interface PreviewResult { audio: Uint8Array; duration: number; elapsedMs: number; voiceId: string; text: string }
export interface NarrationApi {
  setPlaybackActive(active: boolean): void;
  state(): Promise<NarrationState>;
  configure(runtime: Partial<NarrationRuntime>): Promise<NarrationState>;
  importReference(name: string, text: string, filePath?: string): Promise<VoiceProfile | null>;
  renameVoice(id: string, name: string): Promise<void>;
  deleteVoice(id: string): Promise<void>;
  referenceAudio(id: string): Promise<Uint8Array>;
  preview(id: string, text: string): Promise<PreviewResult>;
  createJob(book: NarrationBookInput, voiceId: string): Promise<NarrationJob>;
  job(id: string): Promise<NarrationJob>;
  control(id: string, action: 'resume' | 'pause' | 'retry' | 'delete'): Promise<void>;
  prioritize(id: string, segment: number): Promise<void>;
  audio(id: string, segment: number): Promise<Uint8Array>;
  onChange(cb: () => void): () => void;
}

/** Offsets refer to the original source text, never to a reflowed page. */
export function sentenceSlices(text: string, maxChars = 120): Array<{ text: string; start: number; end: number }> {
  if (!Number.isInteger(maxChars) || maxChars < 8) throw new Error('Invalid sentence length');
  const result: Array<{ text: string; start: number; end: number }> = [];
  const sentencePattern = /.+?(?:[。！？!?]+[”’」』"]*|\.[”’"]*(?=\s|$)|\n+|$)/gsu;
  for (const match of text.matchAll(sentencePattern)) {
    let at = match.index!;
    const end = at + match[0].length;
    while (at < end) {
      let cut = Math.min(at + maxChars, end);
      if (cut < end) {
        const part = text.slice(at, cut);
        const boundary = Math.max(part.lastIndexOf('，'), part.lastIndexOf('；'), part.lastIndexOf(','), part.lastIndexOf('. '), part.lastIndexOf(' '));
        if (boundary > maxChars / 3) cut = at + boundary + 1;
        if (/^[\uDC00-\uDFFF]$/.test(text[cut] ?? '')) cut--;
      }
      const raw = text.slice(at, cut);
      const value = raw.trim();
      if (/[\p{L}\p{N}]/u.test(value)) {
        const start = at + raw.indexOf(value);
        result.push({ text: value.replace(/\s+/g, ' '), start, end: start + value.length });
      }
      at = cut;
    }
  }
  return result;
}

export function findSpeechSegment(segments: NarrationSegment[], position: SpeechPosition): number {
  const inSection = segments.filter(s => s.section === position.section);
  if (!inSection.length) return segments.find(s => s.section > position.section)?.id ?? Math.max(0, segments.length - 1);
  return (inSection.find(s => s.end > position.offset) ?? inSection[inSection.length - 1]).id;
}
