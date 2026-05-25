import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { customerEmailVerifySend, customerEmailVerifySubmit } from '../lib/customerEmailVerify';
import { getCustomerSession, isCustomerMarkedSignedIn, saveCustomerSession } from '../lib/customerSession';
import { getDriverSession, isDriverSignedIn } from '../lib/driverSession';
import { getShopOwnerSession, isShopOwnerSignedIn, saveShopOwnerSession } from '../lib/shopOwnerAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import InGoLogo from '../components/InGoLogo';
import './auth.css';
import './driverVerifySuccessPremium.css';

/** @typedef {'customer' | 'driver' | 'shop_owner'} VerifyRealm */

function parseRealm(raw) {
  const r = String(raw ?? 'customer').trim().toLowerCase();
  if (r === 'driver' || r === 'shop_owner') return /** @type {VerifyRealm} */ (r);
  return 'customer';
}

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15.5 18.5L8.5 12l7-7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconVerifiedCheck() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7.5 12.2l3 2.2 6-5.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 10v6M12 7.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const { state: locationState } = useLocation();
  const [searchParams] = useSearchParams();
  const realm = useMemo(() => parseRealm(searchParams.get('realm')), [searchParams]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [driverPendingApproval, setDriverPendingApproval] = useState(false);

  useEffect(() => {
    const q = searchParams.get('email');
    if (q) setEmail(String(q).trim().toLowerCase());
  }, [searchParams]);

  const codeOk = useMemo(() => /^\d{6}$/.test(code.trim()), [code]);

  const backToLoginPath = realm === 'driver' ? '/driver/login' : realm === 'shop_owner' ? '/shop-owner/login' : '/login';

  if (realm === 'customer' && isCustomerMarkedSignedIn() && getCustomerSession()) {
    return <Navigate to="/home" replace />;
  }
  if (realm === 'driver' && isDriverSignedIn() && getDriverSession()) {
    return <Navigate to="/driver/home" replace />;
  }
  if (realm === 'shop_owner' && isShopOwnerSignedIn() && getShopOwnerSession()) {
    return <Navigate to="/shop-owner/dashboard" replace />;
  }

  const handleResend = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured.');
      return;
    }
    const em = email.trim().toLowerCase();
    if (!em || !password) {
      setErrorMessage('Enter your email and password to resend the code.');
      return;
    }
    setBusy(true);
    try {
      const r = await customerEmailVerifySend({ email: em, password, realm });
      if (!r.ok) {
        setErrorMessage(r.error || 'We could not resend your code. Please try again.');
        return;
      }
      setInfoMessage('A new code was sent to your email.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured.');
      return;
    }
    const em = email.trim().toLowerCase();
    if (!em || !codeOk) {
      setErrorMessage('Enter your email and the 6-digit code from your inbox.');
      return;
    }
    setBusy(true);
    try {
      const v = await customerEmailVerifySubmit({ email: em, code: code.trim(), realm });
      if (!v.ok) {
        setErrorMessage(v.error || 'That code could not be verified. Please check the digits and try again.');
        return;
      }

      if (realm === 'customer') {
        const { data: row, error } = await supabase
          .from('app_users')
          .select('id, full_name, phone, email')
          .eq('email', em)
          .maybeSingle();
        if (error || !row) {
          setErrorMessage('Verified, but could not load your profile. Try logging in.');
          return;
        }
        try {
          localStorage.setItem('ingo_signed_in', '1');
          localStorage.setItem('ingo_onboarding_complete', '1');
        } catch {
          // ignore
        }
        saveCustomerSession(row, { rememberMe });
        navigate('/home', { replace: true });
        return;
      }

      if (realm === 'shop_owner') {
        const { data: row, error } = await supabase
          .from('shop_owners')
          .select('id, business_name, owner_full_name, phone, email, shop_image_url')
          .eq('email', em)
          .maybeSingle();
        if (error || !row) {
          setErrorMessage('Verified, but could not load your shop profile. Try logging in.');
          return;
        }
        saveShopOwnerSession(row, { rememberMe });
        navigate('/shop-owner/dashboard', { replace: true });
        return;
      }

      setDriverPendingApproval(true);
      return;
    } finally {
      setBusy(false);
    }
  };

  const title =
    realm === 'driver' ? 'Verify your driver email' : realm === 'shop_owner' ? 'Verify your shop email' : 'Verify your email';
  const subtitle =
    realm === 'driver'
      ? 'Enter the 6-digit code we emailed you after registration. If you did not get a code, enter your password below and tap Resend.'
      : realm === 'shop_owner'
        ? 'Enter the 6-digit code we sent you. You can then sign in to your shop dashboard.'
        : 'Enter the 6-digit code we sent you. If you did not get a code, enter your password below and tap Resend.';

  if (realm === 'driver' && driverPendingApproval) {
    return (
      <div className="dp-verify-success-page">
        <Link to={backToLoginPath} className="dp-verify-success-back" aria-label="Back to login">
          <IconBack />
        </Link>
        <main className="dp-verify-success-main">
          <div className="dp-verify-success-card">
            <div className="dp-verify-success-illus" aria-hidden>
              <div className="dp-verify-success-check-ring">
                <IconVerifiedCheck />
              </div>
            </div>
            <span className="dp-verify-success-pill">✓ Verification Successful</span>
            <h1 className="dp-verify-success-title">Email Verified!</h1>
            <p className="dp-verify-success-body">
              Your account is under approval. Once your application is approved by an admin, you can log in and start
              working.
            </p>
            <div className="dp-verify-success-info" role="note">
              <span className="dp-verify-success-info-icon" aria-hidden>
                <IconInfo />
              </span>
              <p className="dp-verify-success-info-text">
                You will receive an email notification once your account is approved.
              </p>
            </div>
            <Link to={backToLoginPath} className="dp-verify-success-btn">
              Back to Driver Login
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-page auth-page--register">
      <div className="auth-top">
        <Link to={backToLoginPath} className="auth-back" aria-label="Back to login">
          <IconBack />
        </Link>
      </div>

      <form className="auth-card" onSubmit={handleVerify} noValidate>
        <InGoLogo variant="auth" />
        <h1 className="auth-title auth-title--subhead-gap">{title}</h1>
        <p className="auth-subtitle" style={{ marginBottom: '1rem' }}>
          {subtitle}
        </p>

        {realm === 'driver' && locationState?.codeSent ? (
          <p className="auth-message auth-message--success" style={{ margin: '0 0 1rem' }}>
            We sent a 6-digit verification code to your email. Enter it below to confirm your address.
          </p>
        ) : null}

        <div className="auth-field">
          <label className="auth-label" htmlFor="ve-email">
            Email
          </label>
          <div className="auth-input-wrap">
            <input
              id="ve-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="ve-code">
            Verification code
          </label>
          <div className="auth-input-wrap">
            <input
              id="ve-code"
              className="auth-input"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
        </div>

        <div className="auth-field auth-field--last">
          <label className="auth-label" htmlFor="ve-password">
            Password (for resend)
          </label>
          <div className="auth-input-wrap">
            <input
              id="ve-password"
              className="auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your account password"
            />
          </div>
        </div>

        {realm !== 'driver' ? (
          <div className="auth-options-row">
            <label className="auth-remember">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <span>Remember me after sign-in</span>
            </label>
          </div>
        ) : null}

        <button type="submit" className="auth-btn-primary" disabled={busy || !codeOk}>
          {busy ? 'Please wait…' : realm === 'driver' ? 'Verify email' : 'Verify & continue'}
        </button>
        <button
          type="button"
          className="auth-btn-secondary"
          style={{ marginTop: '0.65rem', width: '100%' }}
          disabled={busy}
          onClick={handleResend}
        >
          Resend code
        </button>

        {errorMessage ? (
          <p className="auth-message auth-message--error" role="alert" style={{ marginTop: '0.75rem' }}>
            {errorMessage}
          </p>
        ) : null}
        {infoMessage ? (
          <p className="auth-message auth-message--success" role="status" style={{ marginTop: '0.75rem' }}>
            {infoMessage}
          </p>
        ) : null}
      </form>

      <p className="auth-foot">
        <Link to={backToLoginPath} className="auth-link-inline">
          Back to login
        </Link>
      </p>
    </div>
  );
}
