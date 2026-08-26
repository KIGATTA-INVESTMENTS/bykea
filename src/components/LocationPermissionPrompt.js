import { useCallback, useEffect, useState } from 'react';
import { geolocationFailureMessage } from '../lib/devicePickupLocation';
import './LocationPermissionPrompt.css';

const LS_SOFT = 'ingo_geo_prompt_soft_dismiss';
const LS_DENIED = 'ingo_geo_prompt_denied_dismiss';

function readLs(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeLs(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {
    // ignore
  }
}

function isStandaloneDisplay() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    if (window.navigator?.standalone === true) return true;
  } catch {
    // ignore
  }
  return false;
}

/**
 * Shown when we still need a GPS fix. Primary button runs `live.refreshFromUserGesture()`
 * so the browser / PWA can show the system location permission dialog on a real tap.
 *
 * `placement="customer"` — fixed above bottom nav (uses inherited `--bnav-total`).
 * `placement="flow"` — inline between map and sheet on delivery / taxi screens.
 */
export default function LocationPermissionPrompt({ live, placement = 'customer' }) {
  const [busy, setBusy] = useState(false);
  const [softDismissed, setSoftDismissed] = useState(() => readLs(LS_SOFT));
  const [deniedDismissed, setDeniedDismissed] = useState(() => readLs(LS_DENIED));
  const [failNotice, setFailNotice] = useState('');

  useEffect(() => {
    if (!live.hasFix) return;
    writeLs(LS_SOFT, '1');
    writeLs(LS_DENIED, '1');
    setFailNotice('');
  }, [live.hasFix]);

  const onAllow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailNotice('');
    try {
      await live.refreshFromUserGesture();
    } catch (err) {
      const code = typeof err?.code === 'number' ? err.code : 2;
      setFailNotice(geolocationFailureMessage(code));
    } finally {
      setBusy(false);
    }
  }, [live, busy]);

  const onSoftDismiss = useCallback(() => {
    setSoftDismissed(true);
    writeLs(LS_SOFT, '1');
  }, []);

  const onDeniedDismiss = useCallback(() => {
    setDeniedDismissed(true);
    writeLs(LS_DENIED, '1');
  }, []);

  if (live.hasFix) return null;
  if (live.geoError === 'unsupported') return null;

  const rootClass = placement === 'flow' ? 'loc-perm loc-perm--flow' : 'loc-perm loc-perm--customer';
  const standalone = isStandaloneDisplay();

  if (live.geoError === 'denied') {
    if (deniedDismissed) return null;
    return (
      <aside className={rootClass} role="alert" aria-label="Location permission">
        <p className="loc-perm__title">Location is off</p>
        <p className="loc-perm__text">
          {standalone
            ? 'For this installed app, open your device settings and allow Location for your browser or InGo. Then tap Retry.'
            : 'Allow location for this site in your browser settings, then tap Retry.'}
        </p>
        {failNotice ? <p className="loc-perm__text loc-perm__text--err">{failNotice}</p> : null}
        <div className="loc-perm__actions">
          <button type="button" className="loc-perm__btn loc-perm__btn--primary" disabled={busy} onClick={onAllow}>
            {busy ? 'Checking…' : 'Retry'}
          </button>
          <button type="button" className="loc-perm__btn loc-perm__btn--ghost" onClick={onDeniedDismiss}>
            Dismiss
          </button>
        </div>
      </aside>
    );
  }

  if (live.geoError === 'out_of_area') {
    return (
      <aside className={rootClass} role="alert" aria-label="Location outside service area">
        <p className="loc-perm__title">Location outside Zimbabwe</p>
        <p className="loc-perm__text">
          Turn on precise GPS (not approximate / IP location) and try again. You can still type your pickup address.
        </p>
        {failNotice ? <p className="loc-perm__text loc-perm__text--err">{failNotice}</p> : null}
        <div className="loc-perm__actions">
          <button type="button" className="loc-perm__btn loc-perm__btn--primary" disabled={busy} onClick={onAllow}>
            {busy ? 'Checking…' : 'Try again'}
          </button>
          <button type="button" className="loc-perm__btn loc-perm__btn--ghost" onClick={onSoftDismiss}>
            Type address instead
          </button>
        </div>
      </aside>
    );
  }

  if (softDismissed && !failNotice && live.geoError !== 'unavailable') return null;

  return (
    <aside className={rootClass} role="region" aria-label="Location permission">
      <p className="loc-perm__title">{standalone ? 'Allow location for InGo' : 'Use your location'}</p>
      <p className="loc-perm__text">
        {standalone
          ? 'Tap Allow so we can show where you are on the map and fill pickup more accurately in this installed app.'
          : 'Tap Allow so we can show your position on the map and use “My current location” for pickup.'}
      </p>
      {failNotice ? <p className="loc-perm__text loc-perm__text--err">{failNotice}</p> : null}
      <div className="loc-perm__actions">
        <button type="button" className="loc-perm__btn loc-perm__btn--primary" disabled={busy} onClick={onAllow}>
          {busy ? 'Getting location…' : 'Allow location'}
        </button>
        <button type="button" className="loc-perm__btn loc-perm__btn--ghost" disabled={busy} onClick={onSoftDismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
