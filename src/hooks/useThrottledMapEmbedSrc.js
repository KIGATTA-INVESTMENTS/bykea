import { useEffect, useRef, useState } from 'react';

/**
 * Map embed iframes reload fully when `src` changes. Throttle updates so live driver
 * tracking does not flicker / get stuck reloading every poll tick.
 * A src that arrives during the throttle window is applied when the window ends
 * (dropping it forever left maps stuck on the first URL).
 *
 * @param {string} src
 * @param {{ throttleMs?: number, bumpKey?: string }} [options]
 * @returns {string}
 */
export function useThrottledMapEmbedSrc(src, options = {}) {
  const throttleMs = options.throttleMs ?? 12000;
  const bumpKey = options.bumpKey ?? '';
  const [displaySrc, setDisplaySrc] = useState(() => src || '');
  const lastRef = useRef({ src: src || '', at: src ? Date.now() : 0, bump: bumpKey });

  useEffect(() => {
    const next = src || '';
    const prev = lastRef.current;
    const bumpChanged = bumpKey !== prev.bump;

    if (!next) {
      lastRef.current = { src: '', at: 0, bump: bumpKey };
      setDisplaySrc('');
      return undefined;
    }

    const now = Date.now();
    const due = !prev.src || bumpChanged || now - prev.at >= throttleMs;
    const changed = next !== prev.src;

    if (!changed && !bumpChanged) return undefined;

    const apply = () => {
      lastRef.current = { src: next, at: Date.now(), bump: bumpKey };
      setDisplaySrc(next);
    };

    if (due) {
      apply();
      return undefined;
    }

    const wait = Math.max(50, throttleMs - (now - prev.at));
    const id = window.setTimeout(apply, wait);
    return () => window.clearTimeout(id);
  }, [src, throttleMs, bumpKey]);

  return displaySrc;
}
