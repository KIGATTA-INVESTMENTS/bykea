import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { uploadCustomerProfilePhoto } from '../lib/customerProfilePhoto';
import { isProfilePhotoColumnError, profilePhotoSaveErrorMessage } from '../lib/profilePhotoSetup';
import { getCustomerSession, saveCustomerSession } from '../lib/customerSession';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './profileEditPremium.css';

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
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

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden>
      <rect x="2.5" y="6" width="18" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export default function ProfileEditPage() {
  const navigate = useNavigate();
  const photoInputRef = useRef(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = getCustomerSession();
    if (!s?.id) {
      navigate('/login', { replace: true });
      return;
    }
    setUserId(s.id);
    setFullName((s.full_name || '').trim());
    setPhone((s.phone || '').trim());
    setEmail((s.email || '').trim());
    setProfilePhotoUrl(s.profile_photo_url?.trim() || null);

    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;

    const loadRow = async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, full_name, phone, email, profile_photo_url')
        .eq('id', s.id)
        .maybeSingle();

      if (cancelled) return;

      if (!error && data) {
        setFullName((data.full_name || '').trim());
        setPhone((data.phone || '').trim());
        setEmail((data.email || '').trim());
        setProfilePhotoUrl(data.profile_photo_url?.trim() || null);
        saveCustomerSession(data);
        return;
      }

      if (error && isProfilePhotoColumnError(error.message)) {
        const { data: fallback } = await supabase
          .from('app_users')
          .select('id, full_name, phone, email')
          .eq('id', s.id)
          .maybeSingle();
        if (cancelled || !fallback) return;
        setFullName((fallback.full_name || '').trim());
        setPhone((fallback.phone || '').trim());
        setEmail((fallback.email || '').trim());
        saveCustomerSession(fallback);
        return;
      }

      if (error || !data) return;
    };

    loadRow();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(
    () => () => {
      if (photoPreview?.startsWith('blob:')) {
        URL.revokeObjectURL(photoPreview);
      }
    },
    [photoPreview],
  );

  const initials = useMemo(() => initialsFromName(fullName), [fullName]);
  const displayPhoto = photoPreview || profilePhotoUrl;

  const pickPhoto = () => {
    setPhotoError('');
    photoInputRef.current?.click();
  };

  const onPhotoChange = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPhotoError('');
    if (!f.type.startsWith('image/')) {
      setPhotoError('Choose an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      setPhotoError('Image is too large. Maximum size is 12 MB.');
      return;
    }
    setPhotoPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setPendingPhotoFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setPhotoError('');
    if (!userId || !isSupabaseConfigured || !supabase) {
      setErrorMessage('Unable to save. Check you are logged in.');
      return;
    }
    const nextEmail = email.trim().toLowerCase();
    if (!fullName.trim() || !phone.trim() || !nextEmail) {
      setErrorMessage('Please fill in name, phone, and email.');
      return;
    }

    setSaving(true);
    try {
      let nextPhotoUrl = profilePhotoUrl;

      if (pendingPhotoFile) {
        setPhotoBusy(true);
        try {
          nextPhotoUrl = await uploadCustomerProfilePhoto(userId, pendingPhotoFile);
        } catch (err) {
          setPhotoError(err?.message || 'Could not upload photo.');
          setSaving(false);
          setPhotoBusy(false);
          return;
        } finally {
          setPhotoBusy(false);
        }
      }

      const { data, error } = await supabase
        .from('app_users')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: nextEmail,
          profile_photo_url: nextPhotoUrl || null,
        })
        .eq('id', userId)
        .select('id, full_name, phone, email, profile_photo_url')
        .maybeSingle();

      if (error) {
        if (isProfilePhotoColumnError(error.message)) {
          const { data: fallback, error: err2 } = await supabase
            .from('app_users')
            .update({
              full_name: fullName.trim(),
              phone: phone.trim(),
              email: nextEmail,
            })
            .eq('id', userId)
            .select('id, full_name, phone, email')
            .maybeSingle();
          if (err2) {
            if (err2.code === '23505') {
              setErrorMessage('That email is already used by another account.');
            } else {
              setErrorMessage(err2.message || 'Could not save changes.');
            }
            return;
          }
          if (fallback) saveCustomerSession(fallback);
          setPhotoError(profilePhotoSaveErrorMessage(error.message));
          return;
        }
        if (error.code === '23505') {
          setErrorMessage('That email is already used by another account.');
        } else {
          setErrorMessage(error.message || 'Could not save changes.');
        }
        return;
      }
      if (data) {
        saveCustomerSession(data);
        setPendingPhotoFile(null);
        setProfilePhotoUrl(data.profile_photo_url?.trim() || null);
      }
      navigate('/profile', { replace: true });
    } catch {
      setErrorMessage('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || photoBusy;

  return (
    <div className="prf-edit-page" role="main" aria-label="Edit profile">
      <header className="prf-edit-nav">
        <Link to="/profile" className="prf-edit-nav__back" aria-label="Back to profile">
          <BackArrow />
        </Link>
        <h1 className="prf-edit-nav__title">Edit Profile</h1>
        <span aria-hidden />
      </header>

      <div className="prf-edit-scroll">
        <div className="prf-edit-photo">
          <div className="prf-edit-photo__wrap">
            {displayPhoto ? (
              <img
                src={displayPhoto}
                alt=""
                className="prf-edit-photo__avatar prf-edit-photo__avatar--img"
              />
            ) : (
              <div className="prf-edit-photo__avatar" aria-hidden>
                {initials}
              </div>
            )}
            <button
              type="button"
              className="prf-edit-photo__btn"
              aria-label="Upload profile photo"
              title="Upload photo"
              onClick={pickPhoto}
              disabled={busy}
            >
              <CameraIcon />
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="prf-edit-photo__file"
              aria-hidden
              tabIndex={-1}
              onChange={onPhotoChange}
            />
          </div>
          <button
            type="button"
            className="prf-edit-photo__label"
            onClick={pickPhoto}
            disabled={busy}
          >
            {photoBusy ? 'Processing…' : pendingPhotoFile ? 'Photo selected — save to apply' : 'Change photo'}
          </button>
          {photoError ? (
            <p className="prf-edit-photo__err" role="alert">
              {photoError}
            </p>
          ) : null}
        </div>

        <form id="prf-edit-form" className="prf-edit-card" onSubmit={handleSubmit} noValidate>
          <h2 className="prf-edit-card__heading">Personal information</h2>

          <div className="prf-edit-field">
            <label className="prf-edit-label" htmlFor="prf-edit-name">
              Full name
            </label>
            <div className="prf-edit-input-wrap">
              <input
                id="prf-edit-name"
                className="prf-edit-input"
                value={fullName}
                onChange={(ev) => setFullName(ev.target.value)}
                autoComplete="name"
                placeholder="Your full name"
              />
            </div>
          </div>

          <div className="prf-edit-field">
            <label className="prf-edit-label" htmlFor="prf-edit-phone">
              Phone
            </label>
            <div className="prf-edit-input-wrap">
              <span className="prf-edit-phone__code">+44</span>
              <input
                id="prf-edit-phone"
                className="prf-edit-input prf-edit-input--phone"
                value={phone}
                onChange={(ev) => setPhone(ev.target.value)}
                autoComplete="tel-national"
                inputMode="tel"
                placeholder="Phone number"
              />
            </div>
          </div>

          <div className="prf-edit-field">
            <label className="prf-edit-label" htmlFor="prf-edit-email">
              Email
            </label>
            <div className="prf-edit-input-wrap">
              <input
                id="prf-edit-email"
                className="prf-edit-input"
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                autoComplete="email"
                placeholder="Email address"
              />
            </div>
          </div>

          {errorMessage ? <p className="prf-edit-error" role="alert">{errorMessage}</p> : null}
        </form>
      </div>

      <div className="prf-edit-footer">
        <button type="submit" form="prf-edit-form" className="prf-edit-save" disabled={busy}>
          {saving ? 'Saving…' : photoBusy ? 'Uploading photo…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
