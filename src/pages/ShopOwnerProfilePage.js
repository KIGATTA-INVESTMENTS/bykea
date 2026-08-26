import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { compressImageToDataUrl } from '../lib/compressImageToDataUrl';
import { clearShopOwnerSession, getShopOwnerSession, saveShopOwnerSession } from '../lib/shopOwnerAuth';
import { SHOP_BUSINESS_TYPES } from '../lib/shopBusinessTypes';
import { isRemoteMediaUrl, uploadShopOwnerLogo } from '../lib/shopMediaUpload';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerProfilePremium.css';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const emptyForm = () => ({
  business: '',
  owner: '',
  phone: '',
  email: '',
  pass: '',
  pass2: '',
  type: SHOP_BUSINESS_TYPES[0],
  address: '',
});

function shopInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const s = (parts[0] || 'SH').replace(/[^a-zA-Z0-9]/g, '');
  if (s.length >= 2) return s.slice(0, 2).toUpperCase();
  const c = (s[0] || 'S').toUpperCase();
  return `${c}${c}`;
}

function IconShop() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 9l2-4h14l2 4M5 9v11h14V9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
      <path d="M4 6h16v12H4V6Zm0 0 8 7 8-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
      <path d="M20 12l-8 8-9-9V4h7l10 8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconEye({ open }) {
  if (open) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" strokeWidth="1.7" />
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

function IconChevronDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="soprf-note-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10v6M12 7h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden className="soprf-upload-icon">
      <path
        d="M4 8h3l1.5-2h7L16 8h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3L2 20h20L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 9v5M12 17h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ProfileField({ label, id, children, hint }) {
  return (
    <div className="soprf-field">
      <label className="soprf-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint}
    </div>
  );
}

export default function ShopOwnerProfilePage() {
  const navigate = useNavigate();
  const session = getShopOwnerSession();
  const [form, setForm] = useState(() => emptyForm());
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const shopImgRef = useRef(null);
  const shopImageFileRef = useRef(null);
  const [shopImageUrl, setShopImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const loadProfile = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    const s = getShopOwnerSession();
    if (!s?.id) {
      setForm(emptyForm());
      setShopImageUrl(null);
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setLoadError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('shop_owners')
      .select('id, business_name, owner_full_name, phone, email, business_type, business_address, shop_image_url')
      .eq('id', s.id)
      .maybeSingle();
    setLoading(false);
    if (error || !data) {
      setLoadError(error?.message || 'Could not load your profile.');
      return;
    }
    const typeVal = data.business_type?.trim() || SHOP_BUSINESS_TYPES[0];
    setForm({
      business: data.business_name ?? '',
      owner: data.owner_full_name ?? '',
      phone: data.phone ?? '',
      email: data.email ?? '',
      pass: '',
      pass2: '',
      type: typeVal,
      address: data.business_address ?? '',
    });
    setShopImageUrl(data.shop_image_url || null);
  }, []);

  useEffect(() => {
    if (!getShopOwnerSession()?.id) {
      setLoading(false);
      return;
    }
    loadProfile();
  }, [loadProfile]);

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

  const save = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSaved(false);
    const s = getShopOwnerSession();
    if (!s?.id) {
      setSaveError('Not signed in.');
      return;
    }
    if (form.pass || form.pass2) {
      if (form.pass !== form.pass2) {
        setSaveError('New passwords do not match.');
        return;
      }
      if (form.pass.length < 6) {
        setSaveError('New password must be at least 6 characters.');
        return;
      }
    }
    if (!isSupabaseConfigured || !supabase) {
      setSaveError('Supabase is not configured.');
      return;
    }

    const emailNorm = form.email.trim().toLowerCase();
    const payload = {
      business_name: form.business.trim(),
      owner_full_name: form.owner.trim(),
      phone: form.phone.trim(),
      email: emailNorm,
      business_type: form.type,
      business_address: form.address.trim(),
    };
    if (shopImageFileRef.current) {
      try {
        const nextImageUrl = await uploadShopOwnerLogo(s.id, shopImageFileRef.current);
        shopImageFileRef.current = null;
        setShopImageUrl(nextImageUrl);
        payload.shop_image_url = nextImageUrl;
      } catch (err) {
        setSaveError(err?.message || 'Could not upload shop photo.');
        return;
      }
    } else if (!shopImageUrl) {
      payload.shop_image_url = null;
    } else if (isRemoteMediaUrl(shopImageUrl)) {
      payload.shop_image_url = shopImageUrl;
    }
    // Skip rewriting legacy data: URLs — keeps profile save light.
    if (form.pass.trim()) {
      payload.password = form.pass;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('shop_owners')
        .update(payload)
        .eq('id', s.id)
        .select('id, business_name, owner_full_name, phone, email, shop_image_url')
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          setSaveError('That email is already used by another account.');
        } else {
          setSaveError(error.message || 'Could not save.');
        }
        return;
      }
      if (data) {
        saveShopOwnerSession(data);
      }
      setForm((f) => ({ ...f, pass: '', pass2: '' }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2800);
    } catch {
      setSaveError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const onLogout = () => {
    clearShopOwnerSession();
    navigate('/shop-owner/login', { replace: true });
  };

  const displayBusiness = form.business.trim() || session?.business_name?.trim() || 'Your shop';
  const displayOwner = form.owner.trim() || session?.owner_full_name?.trim() || '';
  const displayEmail = form.email.trim() || session?.email?.trim() || '';
  const uploadClass = [
    'soprf-upload',
    imageBusy ? 'soprf-upload--busy' : '',
    shopImageUrl ? 'soprf-upload--filled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="soprf-page" role="main" aria-label="Profile and settings">
      <section className="soprf-hero" aria-label="Shop profile">
        <div className="soprf-hero-inner">
          <div className="soprf-avatar" aria-hidden>
            {shopImageUrl ? (
              <img src={shopImageUrl} alt="" />
            ) : (
              <span className="soprf-avatar-initials">{shopInitials(displayBusiness)}</span>
            )}
          </div>
          <div className="soprf-hero-text">
            <h2 className="soprf-hero-shop">{displayBusiness}</h2>
            {displayOwner ? <p className="soprf-hero-owner">{displayOwner}</p> : null}
            {displayEmail ? <p className="soprf-hero-email">{displayEmail}</p> : null}
          </div>
        </div>
      </section>

      <div className="soprf-body">
        <header className="soprf-page-head">
          <h1>Profile &amp; Settings</h1>
          {saved ? (
            <span className="soprf-saved" role="status">
              Saved
            </span>
          ) : null}
        </header>

        {!session?.id ? (
          <p className="soprf-signin-alert" role="alert">
            You are not signed in.{' '}
            <Link to="/shop-owner/login">Go to login</Link>
          </p>
        ) : (
          <>
            <div className="soprf-note" role="note">
              <IconInfo />
              <p>Same details as when you registered — change anything below, then save.</p>
            </div>

            <form className="soprf-card soprf-form" onSubmit={save}>
              <h2 className="soprf-card-title">Shop &amp; Account</h2>
              <div className="soprf-card-divider" aria-hidden />

              {loadError ? (
                <p className="soprf-error" role="alert">
                  {loadError}{' '}
                  <button type="button" className="soprf-retry" onClick={() => loadProfile()}>
                    Retry
                  </button>
                </p>
              ) : null}

              {loading ? (
                <p className="soprf-loading" role="status">
                  Loading your details…
                </p>
              ) : !loadError ? (
                <>
                  {saveError ? (
                    <p className="soprf-error" role="alert">
                      {saveError}
                    </p>
                  ) : null}

                  <input
                    ref={shopImgRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    style={{ display: 'none' }}
                    aria-hidden
                    tabIndex={-1}
                    onChange={onShopImageChange}
                  />

                  <section className="soprf-group" aria-labelledby="soprf-grp-business">
                    <h3 id="soprf-grp-business" className="soprf-group-label">
                      Business Info
                    </h3>

                    <ProfileField label="Business Name" id="sopf-bn">
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconShop />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-bn"
                          value={form.business}
                          onChange={set('business')}
                          required
                          autoComplete="organization"
                        />
                      </div>
                    </ProfileField>

                    <ProfileField label="Owner Full Name" id="sopf-on">
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconPerson />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-on"
                          value={form.owner}
                          onChange={set('owner')}
                          required
                          autoComplete="name"
                        />
                      </div>
                    </ProfileField>

                    <ProfileField label="Phone Number" id="sopf-ph">
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconPhone />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-ph"
                          type="tel"
                          value={form.phone}
                          onChange={set('phone')}
                          required
                          autoComplete="tel"
                        />
                      </div>
                    </ProfileField>

                    <ProfileField label="Email Address" id="sopf-em">
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconEnvelope />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-em"
                          type="email"
                          value={form.email}
                          onChange={set('email')}
                          required
                          autoComplete="email"
                        />
                      </div>
                    </ProfileField>
                  </section>

                  <section className="soprf-group" aria-labelledby="soprf-grp-security">
                    <h3 id="soprf-grp-security" className="soprf-group-label">
                      Security
                    </h3>

                    <ProfileField
                      label={
                        <>
                          New Password <span className="soprf-label-optional">(optional)</span>
                        </>
                      }
                      id="sopf-p1"
                    >
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconLock />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-p1"
                          type={showPass ? 'text' : 'password'}
                          value={form.pass}
                          onChange={set('pass')}
                          minLength={6}
                          autoComplete="new-password"
                          placeholder="Leave blank to keep current password"
                        />
                        <button
                          type="button"
                          className="soprf-toggle"
                          onClick={() => setShowPass((v) => !v)}
                          aria-label={showPass ? 'Hide password' : 'Show password'}
                        >
                          <IconEye open={showPass} />
                        </button>
                      </div>
                    </ProfileField>

                    <ProfileField label="Confirm New Password" id="sopf-p2">
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconLock />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-p2"
                          type={showPass2 ? 'text' : 'password'}
                          value={form.pass2}
                          onChange={set('pass2')}
                          minLength={6}
                          autoComplete="new-password"
                          placeholder="Leave blank if not changing password"
                        />
                        <button
                          type="button"
                          className="soprf-toggle"
                          onClick={() => setShowPass2((v) => !v)}
                          aria-label={showPass2 ? 'Hide password' : 'Show password'}
                        >
                          <IconEye open={showPass2} />
                        </button>
                      </div>
                      {form.pass && form.pass2 && form.pass !== form.pass2 ? (
                        <p className="soprf-pass-hint">Passwords do not match</p>
                      ) : null}
                    </ProfileField>
                  </section>

                  <section className="soprf-group" aria-labelledby="soprf-grp-details">
                    <h3 id="soprf-grp-details" className="soprf-group-label">
                      Details
                    </h3>

                    <ProfileField label="Business Type" id="sopf-ty">
                      <div className="soprf-input-wrap soprf-input-wrap--select">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconTag />
                        </span>
                        <select className="soprf-select" id="sopf-ty" value={form.type} onChange={set('type')}>
                          {!SHOP_BUSINESS_TYPES.includes(form.type) ? (
                            <option value={form.type}>
                              {form.type} (current)
                            </option>
                          ) : null}
                          {SHOP_BUSINESS_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <span className="soprf-select-arrow" aria-hidden>
                          <IconChevronDown />
                        </span>
                      </div>
                    </ProfileField>

                    <ProfileField label="Business Address" id="sopf-ad">
                      <div className="soprf-input-wrap">
                        <span className="soprf-iconbox" aria-hidden>
                          <IconPin />
                        </span>
                        <input
                          className="soprf-input"
                          id="sopf-ad"
                          value={form.address}
                          onChange={set('address')}
                          required
                          autoComplete="street-address"
                        />
                      </div>
                    </ProfileField>

                    <div className="soprf-field">
                      <span className="soprf-upload-label">Shop Photo</span>
                      {imageError ? (
                        <p className="soprf-img-error" role="alert">
                          {imageError}
                        </p>
                      ) : null}
                      <div
                        className={uploadClass}
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
                          <>
                            <IconCamera />
                            <span className="soprf-upload-title">
                              {imageBusy ? 'Processing…' : 'Tap to upload shop photo'}
                            </span>
                            <p className="soprf-upload-optional">optional</p>
                          </>
                        )}
                        {shopImageUrl ? (
                          <button
                            type="button"
                            className="soprf-img-rm"
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
                      <p className="soprf-img-hint">
                        JPEG, PNG, WebP, or GIF — max 12 MB. For production, use Supabase Storage URLs instead of large
                        data URLs.
                      </p>
                    </div>
                  </section>

                  <button type="submit" className="soprf-save-btn" disabled={saving || loading}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              ) : null}
            </form>

            <section className="soprf-danger" aria-labelledby="soprf-danger-title">
              <div className="soprf-danger-head">
                <IconWarning />
                <h2 id="soprf-danger-title" className="soprf-danger-title">
                  Danger Zone
                </h2>
              </div>
              <div className="soprf-danger-actions">
                <button type="button" className="soprf-btn-delete" disabled aria-disabled="true">
                  Delete Account
                </button>
                <button type="button" className="soprf-btn-logout" onClick={onLogout}>
                  Logout
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
