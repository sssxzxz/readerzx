import { useEffect } from 'react';
import { useReaderStore } from '@/store/useReaderStore';

export function useAutoPaging() {
  const autoOn = useReaderStore((s) => s.autoOn);
  const interval = useReaderStore((s) => s.settings.autoInterval);
  const view = useReaderStore((s) => s.view);
  const triggerPage = useReaderStore((s) => s.triggerPage);

  useEffect(() => {
    if (!autoOn || view !== 'reader') return;
    const intervalMs = Math.max(2, interval) * 1000;
    const id = setInterval(() => triggerPage('next'), intervalMs);
    return () => clearInterval(id);
  }, [autoOn, interval, view, triggerPage]);
}
