import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { getCustomerSession, isCustomerMarkedSignedIn, saveCustomerSession } from '../lib/customerSession';
import {
  sanitizePhoneInput,
  validateEmailAddress,
  validatePhoneNumber,
} from '../lib/accountFieldValidation';
import { dialCodeForIso, PHONE_COUNTRY_CODES } from '../lib/phoneCountryCodes';
import { validateReferralCodeOptional } from '../lib/referralCodes';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import InGoLogo from '../components/InGoLogo';
import { LOGIN_HERO_ART, LOGIN_HERO_ICONS } from '../lib/ingoLogo';
import './auth.css';

const ONBOARDING_KEY = 'ingo_onboarding_complete';

const TRUST_BADGES = [
  { key: 'shield', label: 'Secure & Safe' },
  { key: 'clock', label: 'Fast & Reliable' },
  { key: 'headset', label: '24/7 Support' },
  { key: 'medal', label: 'Trusted by Thousands' },
];

function markLoggedIn() {
  try {
    localStorage.setItem('ingo_signed_in', '1');
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    // ignore
  }
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

function IconPerson() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
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

function IconPhone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3L16.5 13l4 1.5v3a1.5 1.5 0 0 1-1.6 1.5 14 14 0 0 1-12.4-12.4A1.5 1.5 0 0 1 6.5 4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

const TRUST_ICONS = {
  shield: TrustShield,
  clock: TrustClock,
  headset: TrustHeadset,
  medal: TrustMedal,
};

function AuthPremiumHero({ back }) {
  return (
    <header className="auth-login-hero">
      {back}
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
  );
}

function AuthTrustFooter() {
  return (
    <footer className="auth-login-footer">
      <div className="auth-login-trust">
        {TRUST_BADGES.map(({ key, label }) => {
          const Icon = TRUST_ICONS[key];
          return (
            <div key={key} className="auth-login-trust-item">
              <span className="auth-login-trust-icon" aria-hidden>
                <Icon />
              </span>
              <span className="auth-login-trust-label">{label}</span>
            </div>
          );
        })}
      </div>
      <p className="auth-login-copyright">
        &copy; {new Date().getFullYear()} InGo. All rights reserved.
      </p>
    </footer>
  );
}

function RegisterShell({ back, children, foot }) {
  return (
    <div className="auth-page auth-page--login auth-page--register">
      <AuthPremiumHero back={back} />
      <main className="auth-login-body">
        <div className="auth-login-card">{children}</div>
        {foot}
      </main>
      <AuthTrustFooter />
    </div>
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agree, setAgree] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [touched, setTouched] = useState({ email: false, phone: false });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [form, setForm] = useState({
    name: '',
    countryIso: 'ZW',
    phone: '',
    email: '',
    password: '',
    confirm: '',
    referralCode: 'INGO-PROMO01',
  });

  const fieldsOk =
    form.name.trim().length > 0 &&
    validatePhoneNumber(form.phone).ok &&
    validateEmailAddress(form.email).ok &&
    form.password.length > 0 &&
    form.password === form.confirm &&
    agree;


  const phoneCheck = validatePhoneNumber(form.phone);
  const emailCheck = validateEmailAddress(form.email);
  const showPhoneError = (touched.phone || attemptedSubmit) && !phoneCheck.ok;
  const showEmailError = (touched.email || attemptedSubmit) && !emailCheck.ok;

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setAttemptedSubmit(true);
    if (!phoneCheck.ok || !emailCheck.ok) return;
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured. Add env vars and restart npm start.');
      return;
    }
    if (!fieldsOk) return;
    const referralCheck = validateReferralCodeOptional(form.referralCode);
    if (!referralCheck.ok) {
      setErrorMessage(referralCheck.error);
      return;
    }
    setIsSubmitting(true);
    const email = emailCheck.value;
    try {
      const dial = dialCodeForIso(form.countryIso);
      const national = form.phone.trim();
      const phoneStored = national ? `${dial} ${national}` : '';
      const verifiedAt = new Date().toISOString();
      const { data: created, error } = await supabase
        .from('app_users')
        .insert({
          full_name: form.name.trim(),
          phone: phoneStored,
          email,
          password: form.password,
          referral_code: referralCheck.value,
          email_verified_at: verifiedAt,
        })
        .select('id, full_name, phone, email')
        .single();

      if (error) {
        if (error.code === '23505') {
          setErrorMessage('This email is already registered. Please login instead.');
        } else {
          setErrorMessage(error.message || 'Could not register right now. Please try again.');
        }
        return;
      }

      markLoggedIn();
      saveCustomerSession(created);
      navigate('/home', { replace: true });
    } catch {
      setErrorMessage('Network error. Please check internet and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCustomerMarkedSignedIn() && getCustomerSession()) {
    return <Navigate to="/home" replace />;
  }

  const loginFoot = (
    <p className="auth-register-foot">
      Already have an account?{' '}
      <Link to="/login" className="auth-register-foot-link">
        Login
      </Link>
    </p>
  );

  return (
    <RegisterShell
      back={
        <Link to="/login" className="auth-login-hero-back" aria-label="Back to login">
          <IconBack />
        </Link>
      }
      foot={loginFoot}
    >
      <form className="auth-login-form" onSubmit={handleRegisterSubmit} noValidate>
        <h2 className="auth-register-title">Create Account</h2>

        <div className="auth-field">
          <label className="auth-login-label" htmlFor="reg-name">
            Full Name
          </label>
          <div className="auth-login-input-wrap">
            <span className="auth-login-iconbox" aria-hidden>
              <IconPerson />
            </span>
            <input
              id="reg-name"
              className="auth-login-input"
              type="text"
              name="name"
              autoComplete="name"
              placeholder="Your full name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-login-label" htmlFor="reg-phone">
            Phone Number
          </label>
          <div className="auth-login-input-wrap auth-register-phone-wrap">
            <span className="auth-login-iconbox" aria-hidden>
              <IconPhone />
            </span>
            <select
              id="reg-country"
              className="auth-register-phone-cc"
              aria-label="Country calling code"
              value={form.countryIso}
              onChange={(e) => setForm((f) => ({ ...f, countryIso: e.target.value }))}
            >
              {PHONE_COUNTRY_CODES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {c.dial} {c.name}
                </option>
              ))}
            </select>
            <input
              id="reg-phone"
              className="auth-login-input auth-register-phone-input"
              type="tel"
              name="phone"
              autoComplete="tel-national"
              inputMode="tel"
              placeholder="7700 900123"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }))}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              aria-invalid={showPhoneError || undefined}
              aria-describedby={showPhoneError ? 'reg-phone-error' : undefined}
            />
          </div>
          {showPhoneError ? (
            <p className="auth-field-hint" id="reg-phone-error" role="alert">
              {phoneCheck.error}
            </p>
          ) : null}
        </div>

        <div className="auth-field">
          <label className="auth-login-label" htmlFor="reg-email">
            Email Address
          </label>
          <div className="auth-login-input-wrap">
            <span className="auth-login-iconbox" aria-hidden>
              <IconEnvelope />
            </span>
            <input
              id="reg-email"
              className="auth-login-input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              aria-invalid={showEmailError || undefined}
              aria-describedby={showEmailError ? 'reg-email-error' : undefined}
            />
          </div>
          {showEmailError ? (
            <p className="auth-field-hint" id="reg-email-error" role="alert">
              {emailCheck.error}
            </p>
          ) : null}
        </div>

        <div className="auth-field">
          <label className="auth-login-label" htmlFor="reg-password">
            Password
          </label>
          <div className="auth-login-input-wrap">
            <span className="auth-login-iconbox" aria-hidden>
              <IconLock />
            </span>
            <input
              id="reg-password"
              className="auth-login-input"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="new-password"
              placeholder="Create a password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
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

        <div className="auth-field">
          <label className="auth-login-label" htmlFor="reg-confirm">
            Confirm Password
          </label>
          <div className="auth-login-input-wrap">
            <span className="auth-login-iconbox" aria-hidden>
              <IconLock />
            </span>
            <input
              id="reg-confirm"
              className="auth-login-input"
              type={showConfirm ? 'text' : 'password'}
              name="confirmPassword"
              autoComplete="new-password"
              placeholder="Confirm your password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            />
            <button
              type="button"
              className="auth-login-input-toggle"
              onClick={() => setShowConfirm((s) => !s)}
              aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
            >
              <IconEye open={!showConfirm} />
            </button>
          </div>
        </div>

        <div className="auth-field auth-field--last">
          <label className="auth-login-label" htmlFor="reg-referral">
            Referral code (optional)
          </label>
          <div className="auth-login-input-wrap">
            <span className="auth-login-iconbox" aria-hidden>
              <IconEnvelope />
            </span>
            <input
              id="reg-referral"
              className="auth-login-input"
              type="text"
              name="referralCode"
              autoComplete="off"
              placeholder="e.g. INGO-XXXXXX"
              value={form.referralCode}
              onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase() }))}
            />
          </div>
        </div>

        <label className="auth-register-terms" htmlFor="reg-terms">
          <input
            id="reg-terms"
            type="checkbox"
            className="auth-login-checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span className="auth-login-checkbox-box" aria-hidden />
          <span className="auth-register-terms-text">
            I agree to the{' '}
            <Link to="/terms" onClick={(e) => e.stopPropagation()}>
              Terms
            </Link>{' '}
            &amp;{' '}
            <Link to="/privacy-policy" onClick={(e) => e.stopPropagation()}>
              Privacy Policy
            </Link>
          </span>
        </label>

        <button type="submit" className="auth-register-btn" disabled={isSubmitting}>
          {isSubmitting ? 'Creating Account...' : 'Create Account'}
        </button>
        {errorMessage ? <p className="auth-message auth-message--error">{errorMessage}</p> : null}
      </form>
    </RegisterShell>
  );
}
