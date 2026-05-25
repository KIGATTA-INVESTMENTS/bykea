import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { getCustomerSession, isCustomerMarkedSignedIn, saveCustomerSession } from '../lib/customerSession';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import InGoLogo from '../components/InGoLogo';
import { LOGIN_HERO_ART, LOGIN_HERO_ICONS } from '../lib/ingoLogo';
import './auth.css';

function IconEnvelope() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16v12H4V6Zm0 0 8 7 8-7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEye({ open }) {
  if (open) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.5 10.5a3 3 0 0 0 3 3M5.2 5.2C3.1 6.4 1.5 8.1 1 9.5c0 0 4 7 11 7 1.2 0 2.3-.2 3.3-.5M8.2 4.2C9.3 3.8 10.6 3.5 12 3.5c7 0 11 6.5 11 6.5-.2.4-1.1 1.6-2.4 2.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconShop() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10h16l-1.2-5H5.2L4 10Zm0 0v9h16v-9M9 19v-6h6v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrustShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TrustClock() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TrustHeadset() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 14v-2a8 8 0 0 1 16 0v2M6 14h-1v4h3v-4M19 14h1v4h-3v-4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrustMedal() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="10" r="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 15l-2 7 5-3 5 3-2-7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

const TRUST_BADGES = [
  { icon: TrustShield, label: 'Secure & Safe' },
  { icon: TrustClock, label: 'Fast & Reliable' },
  { icon: TrustHeadset, label: '24/7 Support' },
  { icon: TrustMedal, label: 'Trusted by Thousands' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');

  if (isCustomerMarkedSignedIn() && getCustomerSession()) {
    return <Navigate to="/home" replace />;
  }

  const goHome = () => {
    navigate('/home', { replace: true });
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setUnverifiedEmail('');
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured. Add env vars and restart npm start.');
      return;
    }
    if (!email.trim() || !password) {
      setErrorMessage('Please enter email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { data: row, error } = await supabase
        .from('app_users')
        .select('id, full_name, phone, email, password, email_verified_at')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message || 'Could not login right now.');
        return;
      }
      if (!row || row.password !== password) {
        setErrorMessage('Invalid email or password.');
        return;
      }
      if (row.email_verified_at === null) {
        setUnverifiedEmail(normalizedEmail);
        setErrorMessage(
          'Please verify your email before logging in. Check your inbox or use the link below.',
        );
        return;
      }

      saveCustomerSession(
        {
          id: row.id,
          full_name: row.full_name,
          phone: row.phone,
          email: row.email,
        },
        { rememberMe },
      );
      goHome();
    } catch {
      setErrorMessage('Network error. Please check internet and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page auth-page--login">
      <header className="auth-login-hero">
        <div className="auth-login-hero-waves" aria-hidden />
        <div className="auth-login-hero-top">
          <h1 className="auth-login-hero-logo-wrap">
            <InGoLogo variant="hero" />
          </h1>
          <p className="auth-login-hero-tagline">Deliver. Ride. Shop.</p>
        </div>
        <div className="auth-login-hero-scene" aria-hidden>
          <img
            src={LOGIN_HERO_ART || LOGIN_HERO_ICONS[0]}
            alt=""
            className="auth-login-hero-art"
            decoding="async"
          />
        </div>
      </header>

      <main className="auth-login-body">
        <div className="auth-login-card">
          <form className="auth-login-form" onSubmit={handleLoginSubmit} noValidate>
            <div className="auth-login-heading">
              <h2 className="auth-login-title">Welcome Back!</h2>
              <p className="auth-login-subtitle">Login to your account</p>
            </div>
            {state?.passwordReset ? (
              <p className="auth-message auth-message--success" role="status">
                Your password was updated. Sign in with your new password.
              </p>
            ) : null}
            {state?.accountDeleted ? (
              <p className="auth-message auth-message--success" role="status">
                Your account was deleted. You can register again with a new account if you wish.
              </p>
            ) : null}

            <div className="auth-field">
              <label className="auth-login-label" htmlFor="login-email">
                Email Address
              </label>
              <div className="auth-login-input-wrap">
                <span className="auth-login-iconbox" aria-hidden>
                  <IconEnvelope />
                </span>
                <input
                  id="login-email"
                  className="auth-login-input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setUnverifiedEmail('');
                  }}
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-login-label" htmlFor="login-password">
                Password
              </label>
              <div className="auth-login-input-wrap">
                <span className="auth-login-iconbox" aria-hidden>
                  <IconLock />
                </span>
                <input
                  id="login-password"
                  className="auth-login-input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-login-input-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <IconEye open={!showPassword} />
                </button>
              </div>
            </div>

            <div className="auth-options-row auth-login-options">
              <label className="auth-login-remember">
                <input
                  type="checkbox"
                  className="auth-login-checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span className="auth-login-checkbox-box" aria-hidden />
                <span>Remember me</span>
              </label>
              <Link to="/forgot-password?realm=customer" className="auth-login-forgot">
                Forgot password?
              </Link>
            </div>

            <button type="submit" className="auth-login-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Logging in...' : 'Login'}
            </button>
            {errorMessage ? <p className="auth-message auth-message--error">{errorMessage}</p> : null}
            {unverifiedEmail && unverifiedEmail === email.trim().toLowerCase() ? (
              <p className="auth-login-verify">
                <Link
                  to={`/verify-email?realm=customer&email=${encodeURIComponent(unverifiedEmail)}`}
                  className="auth-link-inline"
                >
                  Verify email or resend code
                </Link>
              </p>
            ) : null}
          </form>

          <div className="auth-login-or" aria-hidden>
            <span className="auth-login-or-line" />
            <span className="auth-login-or-text">OR</span>
            <span className="auth-login-or-line" />
          </div>

          <p className="auth-login-register-line">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="auth-login-register-link">
              Register
            </Link>
          </p>

          <section className="auth-login-roles" aria-labelledby="login-roles-heading">
            <h3 id="login-roles-heading" className="auth-login-roles-heading">
              Are you a driver or shop owner?
            </h3>
            <div className="auth-login-roles-grid">
              <Link to="/driver/login" className="auth-login-role-btn">
                <span className="auth-login-role-icon" aria-hidden>
                  <IconPerson />
                </span>
                <span className="auth-login-role-text">
                  <strong>Driver Login</strong>
                  <small>Login as a driver</small>
                </span>
              </Link>
              <Link to="/shop-owner/login" className="auth-login-role-btn">
                <span className="auth-login-role-icon" aria-hidden>
                  <IconShop />
                </span>
                <span className="auth-login-role-text">
                  <strong>Shop Owner Login</strong>
                  <small>Login as a shop owner</small>
                </span>
              </Link>
            </div>
          </section>
        </div>
      </main>

      <footer className="auth-login-footer">
        <div className="auth-login-trust">
          {TRUST_BADGES.map(({ icon: Icon, label }) => (
            <div key={label} className="auth-login-trust-item">
              <span className="auth-login-trust-icon" aria-hidden>
                <Icon />
              </span>
              <span className="auth-login-trust-label">{label}</span>
            </div>
          ))}
        </div>
        <p className="auth-login-copyright">
          &copy; {new Date().getFullYear()} InGo. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
