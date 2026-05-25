import { useEffect, useState } from 'react';

/** Largest iPad Pro landscape width is 1366px — keep tablet/iPad on full app. */
export const DESKTOP_VIEWPORT_QUERY = '(min-width: 1367px)';

export function useIsDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(DESKTOP_VIEWPORT_QUERY).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_VIEWPORT_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
