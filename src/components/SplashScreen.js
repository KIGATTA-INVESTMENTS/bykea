import { useEffect } from 'react';
import InGoLogo from './InGoLogo';
import './SplashScreen.css';

const AUTO_ADVANCE_MS = 2800;

export default function SplashScreen({ onComplete }) {
  useEffect(() => {
    const id = setTimeout(() => onComplete(), AUTO_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [onComplete]);

  return (
    <div className="splash" role="status" aria-label="InGo loading">
      <div className="splash__center">
        <InGoLogo variant="splash" className="splash__logo" />
        <p className="splash__tagline">Deliver. Ride. Shop.</p>
      </div>
      <div className="splash__loader" aria-hidden>
        <span className="splash__dot" />
        <span className="splash__dot" />
        <span className="splash__dot" />
      </div>
    </div>
  );
}
