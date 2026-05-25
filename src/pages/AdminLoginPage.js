import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FIXED_ADMIN_EMAIL, isValidAdminCredential, markAdminSignedIn } from '../lib/adminAuth';
import InGoLogo from '../components/InGoLogo';
import './adminPortal.css';

function LogisticsIllustration() {
  return (
    <svg viewBox="0 0 520 300" fill="none" aria-hidden>
      <rect x="55" y="90" width="170" height="92" rx="10" fill="rgba(255,255,255,0.12)" />
      <rect x="220" y="118" width="112" height="64" rx="8" fill="rgba(241,134,49,0.45)" />
      <rect x="334" y="132" width="112" height="50" rx="8" fill="rgba(255,255,255,0.16)" />
      <circle cx="116" cy="198" r="24" fill="rgba(255,255,255,0.26)" />
      <circle cx="350" cy="198" r="24" fill="rgba(255,255,255,0.26)" />
      <path d="M91 83h82M110 58h44M245 100h72" stroke="#fff" strokeWidth="8" strokeLinecap="round" opacity="0.45" />
      <path d="M73 212h358" stroke="#fff" strokeWidth="4" opacity="0.35" />
      <path d="M258 152h35M403 154h22" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function IconEye({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M3 3l18 18M10 10a3 3 0 0 0 4 4M21 12s-4 6-9 6c-1.8 0-3.4-.5-4.7-1.3M8.1 7C9.3 6.4 10.6 6 12 6c6 0 10 6 10 6-1.1 1.8-2.4 3.2-3.9 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    setErrorMessage('');
    if (!isValidAdminCredential(email, password)) {
      setErrorMessage('Invalid admin email or password.');
      return;
    }
    markAdminSignedIn();
    const fromPath = typeof location.state?.from === 'string' ? location.state.from : '/admin/dashboard';
    navigate(fromPath, { replace: true });
  };

  return (
    <div className="adm admLogin">
      <section className="admLoginLeft">
        <h1 className="admLogo">
          <InGoLogo variant="admin" />
        </h1>
        <div className="admHero">
          <LogisticsIllustration />
        </div>
        <h2 className="admTaglineTitle">InGo Admin Panel</h2>
        <p className="admTaglineSub">Manage your entire platform from one place</p>
        <div className="admPills">
          <span className="admPill">Real-time Analytics</span>
          <span className="admPill">Full Control</span>
          <span className="admPill">Secure Access</span>
        </div>
      </section>
      <section className="admLoginRight">
        <div className="admAuthCard">
          <span className="admBadge">Admin Portal</span>
          <h2 className="admAuthTitle">Sign In</h2>
          <p className="admAuthSub">Enter your admin credentials</p>
          {errorMessage ? (
            <p role="alert" style={{ color: '#c62828', margin: '0 0 0.55rem', fontSize: '0.86rem', fontWeight: 700 }}>
              {errorMessage}
            </p>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div className="admField">
              <label htmlFor="admin-email">Email</label>
              <input
                id="admin-email"
                className="admInput"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={FIXED_ADMIN_EMAIL}
                required
              />
            </div>

            <div className="admField">
              <label htmlFor="admin-password">Password</label>
              <div className="admPwWrap">
                <input
                  id="admin-password"
                  className="admInput"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  required
                />
                <button
                  className="admPwToggle"
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <IconEye open={showPassword} />
                </button>
              </div>
            </div>

            <label className="admRemember" htmlFor="admin-remember">
              <input
                id="admin-remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              Remember me
            </label>

            <button className="admBtn" type="submit">
              Sign In
            </button>
          </form>

          <p className="admWarning">
            <span aria-hidden>🔒</span>
            Unauthorized access is prohibited
          </p>
        </div>
      </section>
    </div>
  );
}
