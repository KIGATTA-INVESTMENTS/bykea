import { getGoogleMapsApiKey } from './googleMapsConfig';

let loadPromise = null;
let gmAuthFailureHooked = false;

const GM_AUTH_EVENT = 'ingo-google-maps-auth-failure';
const LOAD_TIMEOUT_MS = 20000;

function hookGmAuthFailureOnce() {
  if (typeof window === 'undefined' || gmAuthFailureHooked) return;
  gmAuthFailureHooked = true;
  const prev = typeof window.gm_authFailure === 'function' ? window.gm_authFailure : null;
  window.gm_authFailure = function ingoGmAuthFailure() {
    try {
      if (prev && prev !== window.gm_authFailure) prev();
    } catch (_) {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(GM_AUTH_EVENT));
  };
}

export { GM_AUTH_EVENT };

function mapsObjectReady() {
  return Boolean(typeof window !== 'undefined' && window.google?.maps?.Map);
}

function importNeededLibraries(google, extra = []) {
  if (!google?.maps) return Promise.reject(new Error('maps api missing'));
  if (typeof google.maps.importLibrary !== 'function') {
    return mapsObjectReady() ? Promise.resolve(google) : Promise.reject(new Error('maps api loaded without Map'));
  }
  const names = ['maps', ...extra.filter(Boolean)];
  return Promise.all(names.map((name) => google.maps.importLibrary(name).catch(() => null))).then(() => {
    if (!google.maps.Map) throw new Error('maps library missing Map');
    return google;
  });
}

/**
 * Loads the Maps JavaScript API once (shared across the app).
 * Enable **Maps JavaScript API** for the same browser key used for Embed.
 *
 * @param {string[]} [extraLibraries]
 * @returns {Promise<typeof globalThis.google>}
 */
export function loadGoogleMapsJs(extraLibraries = []) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('no window'));
  }

  const withLibs = (google) => importNeededLibraries(google, extraLibraries);

  if (mapsObjectReady()) {
    return withLibs(window.google);
  }
  if (loadPromise) return loadPromise.then((google) => withLibs(google));

  const key = getGoogleMapsApiKey();
  if (!key) {
    return Promise.reject(new Error('no api key'));
  }

  hookGmAuthFailureOnce();

  loadPromise = new Promise((resolve, reject) => {
    const cbName = '__ingoGoogleMapsJsCb';
    let settled = false;
    let timeoutId = 0;

    const finishOk = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      importNeededLibraries(window.google)
        .then((google) => resolve(google))
        .catch((err) => {
          loadPromise = null;
          reject(err);
        });
    };

    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      loadPromise = null;
      try {
        delete window[cbName];
      } catch {
        window[cbName] = undefined;
      }
      reject(err instanceof Error ? err : new Error(String(err || 'maps load failed')));
    };

    timeoutId = window.setTimeout(() => {
      finishErr(new Error('maps api load timed out'));
    }, LOAD_TIMEOUT_MS);

    window[cbName] = () => {
      try {
        delete window[cbName];
      } catch {
        window[cbName] = undefined;
      }
      if (window.google?.maps) finishOk();
      else finishErr(new Error('maps api loaded without Map'));
    };

    let s = document.querySelector('script[data-ing-google-maps-js="1"]');
    if (!s) {
      s = document.createElement('script');
      s.async = true;
      s.dataset.ingGoogleMapsJs = '1';
      s.onerror = () => finishErr(new Error('script blocked or failed'));
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        key,
      )}&v=weekly&region=ZW&language=en&loading=async&callback=${cbName}`;
      document.head.appendChild(s);
    } else if (window.google?.maps) {
      finishOk();
    }
  });

  return loadPromise.then((google) => withLibs(google));
}

export function triggerGoogleMapResize(map) {
  try {
    window.google?.maps?.event?.trigger(map, 'resize');
  } catch {
    /* ignore */
  }
}

/**
 * Google Maps does not reflow when its container size changes (route pins, sheets, orientation).
 * @param {google.maps.Map} map
 * @param {HTMLElement} el
 */
export function bindGoogleMapResize(map, el) {
  if (!map || !el) return () => {};
  const run = () => triggerGoogleMapResize(map);
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => run());
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
  }
  window.addEventListener('orientationchange', run);
  window.addEventListener('resize', run);
  const raf = window.requestAnimationFrame(run);
  const t = window.setTimeout(run, 160);
  return () => {
    window.cancelAnimationFrame(raf);
    window.clearTimeout(t);
    ro?.disconnect();
    window.removeEventListener('orientationchange', run);
    window.removeEventListener('resize', run);
  };
}

/** Safe to call on an empty Google Maps host div (no React children). */
export function clearGoogleMapElement(el) {
  if (!el) return;
  try {
    el.replaceChildren();
  } catch {
    el.innerHTML = '';
  }
}

/** For tests or forced re-fetch after a failed load. */
export function resetGoogleMapsJsLoaderForTests() {
  loadPromise = null;
}
