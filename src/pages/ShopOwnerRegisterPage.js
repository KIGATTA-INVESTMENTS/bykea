import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { compressImageToDataUrl } from '../lib/compressImageToDataUrl';
import { saveShopOwnerSession } from '../lib/shopOwnerAuth';
import { SHOP_BUSINESS_TYPES } from '../lib/shopBusinessTypes';
import {
  sanitizePhoneInput,
  validateEmailAddress,
  validatePhoneNumber,
} from '../lib/accountFieldValidation';
import { validateReferralCodeOptional } from '../lib/referralCodes';
import { uploadShopOwnerLogo } from '../lib/shopMediaUpload';
import {
  MOBILE_MONEY_PROVIDERS,
  PAYOUT_METHOD_BANK,
  PAYOUT_METHOD_MOBILE,
  buildShopOwnerPayoutPayload,
  validateShopOwnerPayoutForm,
} from '../lib/shopOwnerPayoutAccount';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import InGoLogo from '../components/InGoLogo';
import './shopOwnerRegisterPremium.css';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function IconShop() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 9l2-4h14l2 4M5 9v11h14V9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 9V6h6v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.8 5.8L17 12l4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
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
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12l-8 8-9-9V4h7l10 8z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2" stroke="currentColor" strokeWidth="1.7" />
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

function IconBank() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10h16M5 10 12 4l7 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v7M10 10v7M14 10v7M18 10v7M4 20h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RegField({ label, id, children, hint, wrapClass = '' }) {
  const wrapCls = ['so-reg-input-wrap', wrapClass].filter(Boolean).join(' ');
  return (
    <div className="so-reg-field">
      <label className="so-reg-label" htmlFor={id}>
        {label}
      </label>
      <div className={wrapCls}>{children}</div>
      {hint}
    </div>
  );
}

export default function ShopOwnerRegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    business: '',
    owner: '',
    phone: '',
    email: '',
    pass: '',
    pass2: '',
    type: SHOP_BUSINESS_TYPES[0],
    address: '',
    referralCode: 'INGO-PROMO01',
    payoutMethod: PAYOUT_METHOD_BANK,
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankBranch: '',
    mobileProvider: 'ecocash',
    mobilePhone: '',
    mobileAccountName: '',
  });
  const [agree, setAgree] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [touched, setTouched] = useState({ email: false, phone: false });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const shopImgRef = useRef(null);
  const shopImageFileRef = useRef(null);
  const [shopImageUrl, setShopImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setPhone = (e) => setForm((f) => ({ ...f, phone: sanitizePhoneInput(e.target.value) }));

  const phoneCheck = validatePhoneNumber(form.phone);
  const emailCheck = validateEmailAddress(form.email);
  const showPhoneError = (touched.phone || attemptedSubmit) && !phoneCheck.ok;
  const showEmailError = (touched.email || attemptedSubmit) && !emailCheck.ok;

  const pickShopImage = () => {
    setImageError('');
    shopImgRef.current?.click();
  };

  const onShopImageChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageError('');
    if (!file.type.startsWith('image/')) {
      setImageError('Choose an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('Image is too large. Maximum size is 12 MB.');
      return;
    }
    setImageBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file, 720, 0.8);
      shopImageFileRef.current = file;
      setShopImageUrl(dataUrl);
    } catch (err) {
      setImageError(err?.message || 'Could not process this image.');
    } finally {
      setImageBusy(false);
    }
  };

  const clearShopImage = () => {
    shopImageFileRef.current = null;
    setShopImageUrl(null);
    setImageError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setAttemptedSubmit(true);
    if (form.pass !== form.pass2) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (!agree) {
      setErrorMessage('Please agree to the terms.');
      return;
    }
    if (!phoneCheck.ok || !emailCheck.ok) return;
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured. Add env vars and restart npm start.');
      return;
    }

    const referralCheck = validateReferralCodeOptional(form.referralCode);
    if (!referralCheck.ok) {
      setErrorMessage(referralCheck.error);
      return;
    }

    const payoutCheck = validateShopOwnerPayoutForm(form);
    if (!payoutCheck.ok) {
      setErrorMessage(payoutCheck.error);
      return;
    }

    setIsSubmitting(true);
    try {
      const payoutPayload = buildShopOwnerPayoutPayload(form);
      const basePayload = {
        business_name: form.business.trim(),
        owner_full_name: form.owner.trim(),
        phone: phoneCheck.value,
        email: emailCheck.value,
        password: form.pass,
        business_type: form.type,
        business_address: form.address.trim(),
        shop_image_url: null,
        referral_code: referralCheck.value,
        email_verified_at: new Date().toISOString(),
        ...payoutPayload,
      };
      const bankPayload = { ...payoutPayload };

      const insertRow = (payload) =>
        supabase
          .from('shop_owners')
          .insert(payload)
          .select('id, business_name, owner_full_name, phone, email, shop_image_url')
          .single();

      let { data: inserted, error } = await insertRow(basePayload);

      if (error && /payout_method|mobile_money|bank_name|bank_account_name|bank_account_number|bank_branch|column/i.test(error.message || '')) {
        console.warn('[ShopOwnerRegister] payout columns missing — run supabase/shop_owners_bank_details.sql. Saving without payout details.');
        const {
          payout_method: _pm,
          mobile_money_provider: _mp,
          mobile_money_phone: _mph,
          mobile_money_account_name: _mn,
          bank_name: _bn,
          bank_account_name: _ban,
          bank_account_number: _bac,
          bank_branch: _bb,
          ...withoutPayout
        } = basePayload;
        ({ data: inserted, error } = await insertRow(withoutPayout));
        if (!error && Object.keys(bankPayload).length) {
          // Try legacy bank-only columns if present
          await supabase
            .from('shop_owners')
            .update({
              bank_name: bankPayload.bank_name,
              bank_account_name: bankPayload.bank_account_name,
              bank_account_number: bankPayload.bank_account_number,
              bank_branch: bankPayload.bank_branch,
            })
            .eq('id', inserted.id);
        }
      }

      if (error) {
        if (error.code === '23505') {
          setErrorMessage('This email is already registered. Try logging in.');
        } else {
          setErrorMessage(error.message || 'Could not register. Run supabase/shop_owners.sql if the table is missing.');
        }
        return;
      }

      if (inserted?.id && shopImageFileRef.current) {
        try {
          const logoUrl = await uploadShopOwnerLogo(inserted.id, shopImageFileRef.current);
          const { data: withLogo } = await supabase
            .from('shop_owners')
            .update({ shop_image_url: logoUrl })
            .eq('id', inserted.id)
            .select('id, business_name, owner_full_name, phone, email, shop_image_url')
            .maybeSingle();
          if (withLogo) inserted = withLogo;
          else inserted = { ...inserted, shop_image_url: logoUrl };
        } catch {
          // Keep account even if logo upload fails.
        }
      }

      saveShopOwnerSession(inserted, { rememberMe: true });
      navigate('/shop-owner/dashboard', { replace: true });
    } catch {
      setErrorMessage('Network error. Please check internet and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="so-reg-page" role="main">
      <header className="so-reg-hero">
        <div className="so-reg-hero-waves" aria-hidden />
        <div className="so-reg-hero-top">
          <InGoLogo variant="hero" />
          <div className="so-reg-hero-badge" role="status">
            Shop Owner Portal
          </div>
          <p className="so-reg-hero-tagline">Grow your business with InGo</p>
          <p className="so-reg-hero-subtitle">
            Reach more customers and manage your deliveries in one place.
          </p>
        </div>
      </header>

      <main className="so-reg-body">
        <div className="so-reg-card">
          <h1 className="so-reg-title">Register Your Shop</h1>
          <p className="so-reg-subtitle">Create your shop owner account</p>

          <form className="so-reg-form" onSubmit={submit} autoComplete="on">
            {errorMessage ? (
              <p className="so-reg-error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <section className="so-reg-group" aria-labelledby="so-reg-grp-info">
              <h2 id="so-reg-grp-info" className="so-reg-group-label">
                Business Info
              </h2>

              <RegField label="Business name" id="sor-bn">
                <span className="so-reg-iconbox" aria-hidden>
                  <IconShop />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-bn"
                  value={form.business}
                  onChange={set('business')}
                  required
                  autoComplete="organization"
                />
              </RegField>

              <RegField label="Owner full name" id="sor-on">
                <span className="so-reg-iconbox" aria-hidden>
                  <IconPerson />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-on"
                  value={form.owner}
                  onChange={set('owner')}
                  required
                  autoComplete="name"
                />
              </RegField>

              <RegField
                label="Phone number"
                id="sor-ph"
                hint={
                  showPhoneError ? (
                    <p className="so-reg-hint" id="sor-ph-error" role="alert">
                      {phoneCheck.error}
                    </p>
                  ) : null
                }
              >
                <span className="so-reg-iconbox" aria-hidden>
                  <IconPhone />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-ph"
                  type="tel"
                  value={form.phone}
                  onChange={setPhone}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  inputMode="tel"
                  required
                  autoComplete="tel"
                  placeholder="+44 7XXX XXXXXX"
                  aria-invalid={showPhoneError || undefined}
                  aria-describedby={showPhoneError ? 'sor-ph-error' : undefined}
                />
              </RegField>

              <RegField
                label="Email address"
                id="sor-em"
                hint={
                  showEmailError ? (
                    <p className="so-reg-hint" id="sor-em-error" role="alert">
                      {emailCheck.error}
                    </p>
                  ) : null
                }
              >
                <span className="so-reg-iconbox" aria-hidden>
                  <IconEnvelope />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-em"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  required
                  autoComplete="email"
                  placeholder="you@shop.com"
                  aria-invalid={showEmailError || undefined}
                  aria-describedby={showEmailError ? 'sor-em-error' : undefined}
                />
              </RegField>
            </section>

            <section className="so-reg-group" aria-labelledby="so-reg-grp-security">
              <h2 id="so-reg-grp-security" className="so-reg-group-label">
                Security
              </h2>

              <RegField label="Password" id="sor-p1">
                <span className="so-reg-iconbox" aria-hidden>
                  <IconLock />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-p1"
                  type={showPass ? 'text' : 'password'}
                  value={form.pass}
                  onChange={set('pass')}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="so-reg-input-toggle"
                  tabIndex={-1}
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  <IconEye open={!showPass} />
                </button>
              </RegField>

              <RegField
                label="Confirm password"
                id="sor-p2"
                hint={
                  form.pass && form.pass2 && form.pass !== form.pass2 ? (
                    <p className="so-reg-hint">Passwords do not match</p>
                  ) : null
                }
              >
                <span className="so-reg-iconbox" aria-hidden>
                  <IconLock />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-p2"
                  type={showPass2 ? 'text' : 'password'}
                  value={form.pass2}
                  onChange={set('pass2')}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="so-reg-input-toggle"
                  tabIndex={-1}
                  onClick={() => setShowPass2((s) => !s)}
                  aria-label={showPass2 ? 'Hide password' : 'Show password'}
                >
                  <IconEye open={!showPass2} />
                </button>
              </RegField>

              <RegField label="Referral code (optional)" id="sor-ref">
                <span className="so-reg-iconbox" aria-hidden>
                  <IconTag />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-ref"
                  value={form.referralCode}
                  onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase() }))}
                  autoComplete="off"
                  placeholder="e.g. INGO-PROMO01"
                />
              </RegField>
            </section>

            <section className="so-reg-group" aria-labelledby="so-reg-grp-details">
              <h2 id="so-reg-grp-details" className="so-reg-group-label">
                Details
              </h2>

              <RegField label="Business type" id="sor-ty" wrapClass="so-reg-select-wrap">
                <span className="so-reg-iconbox" aria-hidden>
                  <IconTag />
                </span>
                <select className="so-reg-select" id="sor-ty" value={form.type} onChange={set('type')}>
                  {SHOP_BUSINESS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="so-reg-select-arrow" aria-hidden>
                  <IconChevronDown />
                </span>
              </RegField>

              <RegField label="Business address" id="sor-ad">
                <span className="so-reg-iconbox" aria-hidden>
                  <IconPin />
                </span>
                <input
                  className="so-reg-input"
                  id="sor-ad"
                  value={form.address}
                  onChange={set('address')}
                  required
                  autoComplete="street-address"
                  placeholder="Street, city, postcode"
                />
              </RegField>

              <input
                ref={shopImgRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: 'none' }}
                aria-hidden
                tabIndex={-1}
                onChange={onShopImageChange}
              />
              <div className="so-reg-field">
                <span className="so-reg-label">
                  Shop photo <span className="so-reg-label-optional">(optional)</span>
                </span>
                {imageError ? (
                  <p className="so-reg-photo-err" role="alert">
                    {imageError}
                  </p>
                ) : null}
                <div
                  className={`so-reg-photo${imageBusy ? ' so-reg-photo--busy' : ''}`}
                  onClick={() => !imageBusy && pickShopImage()}
                  onKeyDown={(e) => {
                    if (imageBusy) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pickShopImage();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={shopImageUrl ? 'Change shop photo' : 'Upload shop photo'}
                >
                  {shopImageUrl ? (
                    <img src={shopImageUrl} alt="" />
                  ) : (
                    <span className="so-reg-photo-placeholder">
                      {imageBusy ? 'Processing…' : 'Tap to add a logo or storefront photo'}
                    </span>
                  )}
                  {shopImageUrl ? (
                    <button
                      type="button"
                      className="so-reg-photo-rm"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearShopImage();
                      }}
                      aria-label="Remove shop photo"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <p className="so-reg-photo-hint">
                  JPEG, PNG, WebP, or GIF — max 12 MB. Image is resized in your browser. You can skip this and add one
                  later from your profile when that is available.
                </p>
              </div>
            </section>

            <section className="so-reg-group" aria-labelledby="so-reg-grp-payout">
              <h2 id="so-reg-grp-payout" className="so-reg-group-label">
                Payout Account Details
              </h2>
              <p className="so-reg-group-note">
                Choose Bank or Mobile money for withdrawals. Used by admin to pay out your earnings.
              </p>

              <fieldset className="so-reg-payout-choice">
                <legend className="so-reg-label">Payout method</legend>
                <div className="so-reg-payout-choice__row" role="radiogroup" aria-label="Payout method">
                  <label className={`so-reg-payout-chip${form.payoutMethod === PAYOUT_METHOD_BANK ? ' so-reg-payout-chip--on' : ''}`}>
                    <input
                      type="radio"
                      name="sor-payout-method"
                      value={PAYOUT_METHOD_BANK}
                      checked={form.payoutMethod === PAYOUT_METHOD_BANK}
                      onChange={() => setForm((f) => ({ ...f, payoutMethod: PAYOUT_METHOD_BANK }))}
                    />
                    Bank account
                  </label>
                  <label className={`so-reg-payout-chip${form.payoutMethod === PAYOUT_METHOD_MOBILE ? ' so-reg-payout-chip--on' : ''}`}>
                    <input
                      type="radio"
                      name="sor-payout-method"
                      value={PAYOUT_METHOD_MOBILE}
                      checked={form.payoutMethod === PAYOUT_METHOD_MOBILE}
                      onChange={() => setForm((f) => ({ ...f, payoutMethod: PAYOUT_METHOD_MOBILE }))}
                    />
                    Mobile money
                  </label>
                </div>
              </fieldset>

              {form.payoutMethod === PAYOUT_METHOD_BANK ? (
                <>
                  <RegField label="Bank name" id="sor-bank">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconBank />
                    </span>
                    <input
                      className="so-reg-input"
                      id="sor-bank"
                      value={form.bankName}
                      onChange={set('bankName')}
                      autoComplete="off"
                      placeholder="e.g. CBZ Bank, Steward Bank"
                    />
                  </RegField>

                  <RegField label="Account holder name" id="sor-bankname">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconPerson />
                    </span>
                    <input
                      className="so-reg-input"
                      id="sor-bankname"
                      value={form.bankAccountName}
                      onChange={set('bankAccountName')}
                      autoComplete="off"
                      placeholder="Name as it appears on the account"
                    />
                  </RegField>

                  <RegField label="Account number" id="sor-bankacc">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconCard />
                    </span>
                    <input
                      className="so-reg-input"
                      id="sor-bankacc"
                      value={form.bankAccountNumber}
                      onChange={set('bankAccountNumber')}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="Bank account number"
                    />
                  </RegField>

                  <RegField label="Branch / branch code" id="sor-bankbr">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconPin />
                    </span>
                    <input
                      className="so-reg-input"
                      id="sor-bankbr"
                      value={form.bankBranch}
                      onChange={set('bankBranch')}
                      autoComplete="off"
                      placeholder="Branch name or code"
                    />
                  </RegField>
                </>
              ) : (
                <>
                  <RegField label="Mobile money provider" id="sor-mm-provider" wrapClass="so-reg-select-wrap">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconPhone />
                    </span>
                    <select
                      className="so-reg-select"
                      id="sor-mm-provider"
                      value={form.mobileProvider}
                      onChange={set('mobileProvider')}
                    >
                      {MOBILE_MONEY_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </RegField>

                  <RegField label="Name on mobile money account" id="sor-mm-name">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconPerson />
                    </span>
                    <input
                      className="so-reg-input"
                      id="sor-mm-name"
                      value={form.mobileAccountName}
                      onChange={set('mobileAccountName')}
                      autoComplete="off"
                      placeholder="Exactly as shown on EcoCash / OneMoney / InnBucks"
                    />
                  </RegField>

                  <RegField label="Mobile money phone number" id="sor-mm-phone">
                    <span className="so-reg-iconbox" aria-hidden>
                      <IconPhone />
                    </span>
                    <input
                      className="so-reg-input"
                      id="sor-mm-phone"
                      value={form.mobilePhone}
                      onChange={(e) => setForm((f) => ({ ...f, mobilePhone: sanitizePhoneInput(e.target.value) }))}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="Registered wallet number"
                    />
                  </RegField>
                </>
              )}
            </section>

            <label className="so-reg-terms">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
              <span>
                I agree to the{' '}
                <Link to="/terms" onClick={(e) => e.stopPropagation()}>
                  terms
                </Link>
              </span>
            </label>

            <button className="so-reg-btn" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Register My Shop'}
            </button>
          </form>
        </div>

        <p className="so-reg-foot">
          Already have an account? <Link to="/shop-owner/login">Login</Link>
        </p>
      </main>
    </div>
  );
}
