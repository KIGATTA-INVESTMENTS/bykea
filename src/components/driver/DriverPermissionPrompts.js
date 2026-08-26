import { useCallback, useEffect, useState } from 'react';
import { unlockDriverOfferAudio } from '../../lib/driverOfferRing';
import '../LocationPermissionPrompt.css';
import './driverPermissionPrompts.css';

/**
 * Location prompt while online. Offline/closed-app push prompts removed for now.
 */
export default function DriverPermissionPrompts({ live, online }) {
  const [locBusy, setLocBusy] = useState(false);
  const [locDismissed, setLocDismissed] = useState(false);

  useEffect(() => {
    if (!online) return undefined;
    // Unlock in-app ring on first tap anywhere (no offline push prompt).
    const unlock = () => unlockDriverOfferAudio();
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [online]);

  useEffect(() => {
    if (live?.hasFix) setLocDismissed(false);
  }, [live?.hasFix]);

  const enableLocation = useCallback(async () => {
    if (!live?.refreshFromUserGesture) return;
    setLocBusy(true);
    try {
      await live.refreshFromUserGesture();
    } catch {
      /* geoError reflected on live */
    } finally {
      setLocBusy(false);
    }
  }, [live]);

  if (!online) return null;

  const needLoc =
    live &&
    !locDismissed &&
    !live.hasFix &&
    live.geoError !== 'unsupported';

  if (!needLoc) return null;

  return (
    <div className="drv-perm-stack" aria-live="polite">
      <aside className="loc-perm loc-perm--driver" role="alert" aria-label="Location permission">
        <p className="loc-perm__title">
          {live.geoError === 'denied' ? 'Location is off' : 'Turn on location'}
        </p>
        <p className="loc-perm__text">
          {live.geoError === 'denied'
            ? 'Allow location for this site in your browser or phone settings, then tap Retry. Customers nearby need your live position.'
            : 'Allow location so nearby customers can find you and you can receive nearby bookings while online.'}
        </p>
        <div className="loc-perm__actions">
          <button
            type="button"
            className="loc-perm__btn loc-perm__btn--primary"
            disabled={locBusy}
            onClick={enableLocation}
          >
            {locBusy ? 'Checking…' : live.geoError === 'denied' ? 'Retry location' : 'Allow location'}
          </button>
          <button
            type="button"
            className="loc-perm__btn loc-perm__btn--ghost"
            onClick={() => setLocDismissed(true)}
          >
            Not now
          </button>
        </div>
      </aside>
    </div>
  );
}
