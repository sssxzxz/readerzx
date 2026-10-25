import { useEffect } from 'react';
import { useReaderStore } from '@/store/useReaderStore';
import ReaderView from '@/components/ReaderView';

export default function App() {
  const {
    hydrate,
    openByPath,
    toggleSettings,
    toggleToc,
    toggleAuto,
    toggleNotes,
    toggleImmersive,
    triggerTtsToggle,
    openByDialog,
  } = useReaderStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Wire up menu events from Electron main process
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(window.api.onMenu('open', () => openByDialog()));
    offs.push(window.api.onMenu('toggle-settings', () => toggleSettings()));
    offs.push(window.api.onMenu('toggle-toc', () => toggleToc()));
    offs.push(window.api.onMenu('toggle-auto', () => toggleAuto()));
    offs.push(window.api.onMenu('toggle-tts', () => triggerTtsToggle()));
    offs.push(window.api.onMenu('toggle-notes', () => toggleNotes()));
    offs.push(window.api.onMenu('toggle-immersive', () => toggleImmersive()));
    offs.push(window.api.onShellOpen((p) => void openByPath(p)));
    return () => offs.forEach((f) => f());
  }, [
    openByDialog,
    toggleSettings,
    toggleToc,
    toggleAuto,
    triggerTtsToggle,
    toggleNotes,
    toggleImmersive,
    openByPath,
  ]);

  // Global drag-and-drop (works in both home and reader views)
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
      if (file?.path) void openByPath(file.path);
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openByPath]);

  return (
    <div className="w-screen h-screen bg-bg text-fg">
      <ReaderView />
    </div>
  );
}
