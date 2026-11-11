import { useCallback, useEffect, useRef, useState } from 'react';

export function useIdleCursor(enabled: boolean, showCursor: () => void) {
  const [hidden, setHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const activity = useCallback(() => {
    clearTimeout(timer.current);
    if (!enabled) return;
    showCursor();
    setHidden(false);
    timer.current = setTimeout(() => setHidden(true), 3000);
  }, [enabled, showCursor]);
  useEffect(() => {
    setHidden(false);
    if (!enabled) return;
    activity();
    const blur = () => { clearTimeout(timer.current); setHidden(false); };
    window.addEventListener('mousemove', activity, true);
    window.addEventListener('mousedown', activity, true);
    window.addEventListener('focus', activity);
    window.addEventListener('blur', blur);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('mousemove', activity, true);
      window.removeEventListener('mousedown', activity, true);
      window.removeEventListener('focus', activity);
      window.removeEventListener('blur', blur);
    };
  }, [enabled, activity]);
  return { hidden: enabled && hidden, activity };
}
