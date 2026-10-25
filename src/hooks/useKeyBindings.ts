import { useEffect } from 'react';
import { useReaderStore } from '@/store/useReaderStore';
import { eventToKeyString } from '@/lib/keys';
import type { ReadingLayout } from '@shared/types';

interface FixedLayoutZoomControls {
  zoomIn: () => void;
  zoomOut: () => void;
}

export function useKeyBindings(fixedLayoutZoom?: FixedLayoutZoomControls) {
  const {
    book,
    settings,
    triggerPage,
    toggleAuto,
    toggleSettings,
    toggleToc,
    toggleNotes,
    toggleImmersive,
    toggleFullscreen,
    toggleCursorHidden,
    openByDialog,
    setSettings,
    triggerSelectionHighlight,
    triggerTtsToggle,
  } = useReaderStore();

  useEffect(() => {
    function isTextInput(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    }

    function onKey(e: KeyboardEvent) {
      if (isTextInput(e.target)) return;
      const k = eventToKeyString(e);
      if (!k) return;
      const b = settings.bindings;
      if (b.nextPage.includes(k)) {
        e.preventDefault();
        triggerPage('next');
        return;
      }
      if (b.prevPage.includes(k)) {
        e.preventDefault();
        triggerPage('prev');
        return;
      }
      if (b.toggleAuto.includes(k)) {
        e.preventDefault();
        toggleAuto();
        return;
      }
      if (b.openFile.includes(k)) {
        e.preventDefault();
        void openByDialog();
        return;
      }
      if (b.toggleSettings.includes(k)) {
        e.preventDefault();
        toggleSettings();
        return;
      }
      if (b.toggleToc.includes(k)) {
        e.preventDefault();
        toggleToc();
        return;
      }
      if (b.fontUp.includes(k)) {
        e.preventDefault();
        if (book?.format === 'pdf') fixedLayoutZoom?.zoomIn();
        else setSettings({ fontSize: settings.fontSize + 2 });
        return;
      }
      if (b.fontDown.includes(k)) {
        e.preventDefault();
        if (book?.format === 'pdf') fixedLayoutZoom?.zoomOut();
        else setSettings({ fontSize: Math.max(8, settings.fontSize - 2) });
        return;
      }
      if (b.toggleFullscreen?.includes(k)) {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (b.toggleImmersive?.includes(k)) {
        e.preventDefault();
        toggleImmersive();
        return;
      }
      if (b.toggleNotes?.includes(k)) {
        e.preventDefault();
        toggleNotes();
        return;
      }
      if (b.toggleCursor?.includes(k)) {
        e.preventDefault();
        toggleCursorHidden();
        return;
      }
      if (b.toggleWheelPaging?.includes(k)) {
        e.preventDefault();
        setSettings({ wheelPaging: !settings.wheelPaging });
        return;
      }
      if (b.toggleClickPaging?.includes(k)) {
        e.preventDefault();
        setSettings({ clickPaging: !settings.clickPaging });
        return;
      }
      if (b.togglePageFlipAnimation?.includes(k)) {
        e.preventDefault();
        setSettings({ pageFlipAnimation: !settings.pageFlipAnimation });
        return;
      }
      if (b.toggleTts?.includes(k)) {
        e.preventDefault();
        triggerTtsToggle();
        return;
      }
      if (b.cycleReadingLayout?.includes(k)) {
        e.preventDefault();
        const next: ReadingLayout =
          settings.readingLayout === 'paginated' ? 'vertical' : 'paginated';
        setSettings({ readingLayout: next });
        return;
      }
      if (b.cycleColumnCount?.includes(k)) {
        e.preventDefault();
        const n = settings.columnCount;
        const next = (n >= 3 ? 1 : n + 1) as 1 | 2 | 3;
        setSettings({ columnCount: next });
        return;
      }
      if (b.commitSelectionHighlight?.includes(k)) {
        e.preventDefault();
        triggerSelectionHighlight();
        return;
      }
    }

    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, [
    settings,
    book?.format,
    fixedLayoutZoom,
    triggerPage,
    toggleAuto,
    toggleSettings,
    toggleToc,
    toggleNotes,
    toggleImmersive,
    toggleFullscreen,
    toggleCursorHidden,
    openByDialog,
    setSettings,
    triggerSelectionHighlight,
    triggerTtsToggle,
  ]);
}
