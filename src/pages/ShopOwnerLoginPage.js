import { useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  getRememberedShopOwnerEmail,
  isShopOwnerSignedIn,
  saveShopOwnerSession,
  setRememberedShopOwnerEmail,
} from '../lib/shopOwnerAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import InGoLogo from '../components/InGoLogo';
import './shopOwnerLoginPremium.css';

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

function IconShopHero() {
  return (
    <svg className="so-login-hero-art" viewBox="0 0 120 88" fill="none" aria-hidden>
      <path
        d="M8 72V36l12-8h32l12 8v36H8z"
        fill="currentColor"
        opacity="0.95"
      />
      <path d="M20 28h48v8H20v-8z" fill="#fff" opacity="0.35" />
      <rect x="28" y="44" width="14" height="18" rx="1" fill="#fff" opacity="0.5" />
      <rect x="50" y="44" width="14" height="18" rx="1" fill="#fff" opacity="0.5" />
      <rect x="72" y="44" width="14" height="18" rx="1" fill="#fff" opacity="0.5" />
      <path
        d="M44 20h32l6 8H38l6-8z"
        fill="currentColor"
      />
      <path
        d="M88 52c0-8 6-14 14-14h6v14H88z"
        fill="currentColor"
        opacity="0.85"
      />
      <circle cx="98" cy="58" r="5" fill="#fff" opacity="0.4" />
      <path
        d="M94 68h20l-4 8H90l4-8z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

function TrustShop() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 9l2-4h14l2 4M5 9v11h14V9M9 13h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 9V6h6v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TrustChart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19V5M4 19h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M8 15v-4M12 15V8M16 15V11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrustHeadset() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 14v-2a8 8 0 0 1 16 0v2M6 14h0a2 2 0 0 1 2 2v2H4v-4M18 14h0a2 2 0 0 0 2 2v2h-4v-4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TRUST_BADGES = [
  { icon: TrustShop, label: 'Easy Setup' },
  { icon: TrustChart, label: 'Grow Sales' },
  { icon: TrustHeadset, label: '24/7 Support' },
];

export default function ShopOwnerLoginPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [email, setEmail] = useState(() => getRememberedShopOwnerEmail());
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isShopOwnerSignedIn()) {
    const to = state?.from?.pathname || '/shop-owner/dashboard';
    return <Navigate to={to} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
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
        .from('shop_owners')
        .select('id, business_name, owner_full_name, phone, email, shop_image_url, password')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message || 'Could not log in right now.');
        return;
      }
      if (!row || row.password !== password) {
        setErrorMessage('Invalid email or password.');
        return;
      }

      saveShopOwnerSession(
        {
          id: row.id,
          business_name: row.business_name,
          owner_full_name: row.owner_full_name,
          phone: row.phone,
          email: row.email,
          shop_image_url: row.shop_image_url,
        },
        { rememberMe: remember },
      );
      if (remember) setRememberedShopOwnerEmail(normalizedEmail);
      else setRememberedShopOwnerEmail('');
      const to = state?.from?.pathname || '/shop-owner/dashboard';
      navigate(to, { replace: true });
    } catch {
      setErrorMessage('Network error. Please check internet and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="so-login-page" role="main">
      <header className="so-login-hero">
        <div className="so-login-hero-waves" aria-hidden />
        <div className="so-login-hero-top">
          <InGoLogo variant="hero" />
          <div className="so-login-hero-badge" role="status">
            Shop Owner Portal
          </div>
          <p className="so-login-hero-tagline">Grow your business with InGo</p>
          <p className="so-login-hero-subtitle">
            Reach more customers and manage your deliveries in one place.
          </p>
        </div>
        <div className="so-login-hero-scene" aria-hidden>
          <IconShopHero />
        </div>
      </header>

      <main className="so-login-body">
        <div className="so-login-card">
          <form className="so-login-form" onSubmit={submit} autoComplete="on">
            <h1 className="so-login-title">Welcome Back</h1>
            <p className="so-login-subtitle">Login to your dashboard</p>

            {state?.passwordReset && (
              <p className="so-login-flash" role="status">
                Password updated. Sign in with your new password.
              </p>
            )}
            {state?.registered && (
              <p className="so-login-flash so-login-flash--warn" role="status">
                Your shop is registered. You can sign in now.
              </p>
            )}
            {errorMessage ? (
              <p className="so-login-error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="so-login-field">
              <label className="so-login-label" htmlFor="sop-em">
                Email
              </label>
              <div className="so-login-input-wrap">
                <span className="so-login-iconbox" aria-hidden>
                  <IconEnvelope />
                </span>
                <input
                  className="so-login-input"
                  id="sop-em"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@shop.com"
                  required
                />
              </div>
            </div>

            <div className="so-login-field">
              <label className="so-login-label" htmlFor="sop-pw">
                Password
              </label>
              <div className="so-login-input-wrap">
                <span className="so-login-iconbox" aria-hidden>
                  <IconLock />
                </span>
                <input
                  className="so-login-input"
                  id="sop-pw"
                  name="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className="so-login-input-toggle"
                  tabIndex={-1}
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  <IconEye open={!show} />
                </button>
              </div>
            </div>

            <div className="so-login-row">
              <label className="so-login-chk">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember me
              </label>
              <Link to="/forgot-password?realm=shop_owner" className="so-login-forgot">
                Forgot password?
              </Link>
            </div>

            <button type="submit" className="so-login-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Login'}
            </button>
          </form>

          <div className="so-login-or" aria-hidden>
            <span className="so-login-or-line" />
            <span className="so-login-or-text">OR</span>
            <span className="so-login-or-line" />
          </div>

          <Link to="/shop-owner/register" className="so-login-register-btn">
            Register Your Shop
          </Link>
        </div>
      </main>

      <footer className="so-login-footer">
        <div className="so-login-trust">
          {TRUST_BADGES.map(({ icon: Icon, label }) => (
            <div key={label} className="so-login-trust-item">
              <span className="so-login-trust-icon" aria-hidden>
                <Icon />
              </span>
              <span className="so-login-trust-label">{label}</span>
            </div>
          ))}
        </div>
        <p className="so-login-copyright">
          &copy; {new Date().getFullYear()} InGo. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
