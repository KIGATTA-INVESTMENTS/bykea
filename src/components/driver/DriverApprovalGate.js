import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isCurrentDriverApprovedForWork } from '../../lib/driverApproval';
import { clearDriverSession, getDriverSession } from '../../lib/driverSession';

/**
 * Ensures signed-in drivers are still approved in the database before using the portal.
 */
export default function DriverApprovalGate({ children }) {
  const location = useLocation();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const session = getDriverSession();
      if (!session?.id) {
        if (!cancelled) setStatus('denied');
        return;
      }
      const ok = await isCurrentDriverApprovedForWork(session.id);
      if (cancelled) return;
      // Only an explicit "no" from the database ends the session. `null` means the
      // check itself failed; the driver stays signed in and the next route change
      // checks again.
      if (ok === false) {
        clearDriverSession();
        setStatus('denied');
        return;
      }
      setStatus('ok');
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (status === 'checking') {
    return (
      <div
        className="driver-app"
        style={{
          minHeight: '40vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#07408f',
          fontWeight: 600,
          fontSize: '0.9rem',
        }}
        role="status"
        aria-live="polite"
      >
        Checking driver account…
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <Navigate
        to="/driver/login"
        replace
        state={{
          pendingApproval: true,
          emailVerified: true,
          from: location.pathname,
        }}
      />
    );
  }

  return children;
}
