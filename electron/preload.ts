import { contextBridge, ipcRenderer } from 'electron';
import type { VoiceEvent } from '../shared/voice';
import type { NarrationApi } from '../shared/narration';
import type {
  Highlight,
  ReaderSettings,
  ReadingProgress,
  RecentBook,
  OpenedBook,
} from '../shared/types';

const narration:NarrationApi={
  setPlaybackActive:active=>ipcRenderer.send('narration:playback-active',active),
  state:()=>ipcRenderer.invoke('narration:state'),
  configure:r=>ipcRenderer.invoke('narration:configure',r),
  importReference:(name,text,file)=>ipcRenderer.invoke('narration:importReference',name,text,file),
  renameVoice:(id,name)=>ipcRenderer.invoke('narration:renameVoice',id,name),
  deleteVoice:id=>ipcRenderer.invoke('narration:deleteVoice',id),
  referenceAudio:id=>ipcRenderer.invoke('narration:referenceAudio',id),
  preview:(id,text)=>ipcRenderer.invoke('narration:preview',id,text),
  createJob:(book,id)=>ipcRenderer.invoke('narration:createJob',book,id),
  job:id=>ipcRenderer.invoke('narration:job',id),
  control:(id,action)=>ipcRenderer.invoke('narration:control',id,action),
  prioritize:(id,segment)=>ipcRenderer.invoke('narration:prioritize',id,segment),
  audio:(id,segment)=>ipcRenderer.invoke('narration:audio',id,segment),
  onChange:cb=>{const fn=()=>cb();ipcRenderer.on('narration:changed',fn);return ()=>ipcRenderer.removeListener('narration:changed',fn);},
};
const api = {
  narration,
  startVoiceControl: (sessionId: number): Promise<void> => ipcRenderer.invoke('voice:start', sessionId),
  stopVoiceControl: (): Promise<void> => ipcRenderer.invoke('voice:stop'),
  onVoiceEvent: (cb: (event: VoiceEvent) => void) => {
    const listener = (_e: unknown, event: VoiceEvent) => cb(event);
    ipcRenderer.on('voice:event', listener);
    return () => ipcRenderer.removeListener('voice:event', listener);
  },
  // File ops
  openFileDialog: (): Promise<OpenedBook | null> =>
    ipcRenderer.invoke('file:open-dialog'),
  openFileByPath: (filePath: string): Promise<OpenedBook | null> =>
    ipcRenderer.invoke('file:open-path', filePath),

  // Settings
  loadSettings: (): Promise<ReaderSettings> =>
    ipcRenderer.invoke('store:load-settings'),
  saveSettings: (s: ReaderSettings): Promise<void> =>
    ipcRenderer.invoke('store:save-settings', s),
  loadBookSettings: (bookId: string): Promise<ReaderSettings | null> =>
    ipcRenderer.invoke('store:load-book-settings', bookId),
  saveBookSettings: (bookId: string, s: ReaderSettings): Promise<void> =>
    ipcRenderer.invoke('store:save-book-settings', bookId, s),
  deleteBookSettings: (bookId: string): Promise<void> =>
    ipcRenderer.invoke('store:delete-book-settings', bookId),

  // Progress
  loadProgress: (bookId: string): Promise<ReadingProgress | null> =>
    ipcRenderer.invoke('store:load-progress', bookId),
  saveProgress: (p: ReadingProgress): Promise<void> =>
    ipcRenderer.invoke('store:save-progress', p),

  // Recent
  loadRecent: (): Promise<RecentBook[]> => ipcRenderer.invoke('store:load-recent'),
  addRecent: (b: RecentBook): Promise<void> => ipcRenderer.invoke('store:add-recent', b),
  removeRecent: (bookId: string): Promise<void> =>
    ipcRenderer.invoke('store:remove-recent', bookId),
  clearRecent: (): Promise<void> => ipcRenderer.invoke('store:clear-recent'),

  // Notes / highlights
  listNotes: (bookId: string): Promise<Highlight[]> =>
    ipcRenderer.invoke('notes:list', bookId),
  saveNotes: (bookId: string, list: Highlight[]): Promise<void> =>
    ipcRenderer.invoke('notes:save', bookId, list),
  clearNotes: (bookId: string): Promise<void> =>
    ipcRenderer.invoke('notes:clear', bookId),

  // Window control
  setFullscreen: (on?: boolean): Promise<boolean> =>
    ipcRenderer.invoke('window:set-fullscreen', on),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
  onFullscreenChange: (cb: (on: boolean) => void) => {
    const listener = (_e: unknown, on: boolean) => cb(on);
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },

  // Menu events
  onMenu: (event: string, cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(`menu:${event}`, listener);
    return () => ipcRenderer.removeListener(`menu:${event}`, listener);
  },
  onShellOpen: (cb: (path: string) => void) => {
    const listener = (_e: unknown, p: string) => cb(p);
    ipcRenderer.on('open-file-from-shell', listener);
    return () => ipcRenderer.removeListener('open-file-from-shell', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
