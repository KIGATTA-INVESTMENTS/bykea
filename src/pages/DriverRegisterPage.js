import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dialCodeForIso, PHONE_COUNTRY_CODES } from '../lib/phoneCountryCodes';
import { customerEmailVerifySend } from '../lib/customerEmailVerify';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { formatVehicleTypeForDisplay } from '../lib/vehicleTypeDisplay';
import { PARCEL_DRIVER_VEHICLE_TYPES } from '../lib/deliveryVehicleTypes';
import './driverRegisterPremium.css';

const VEHICLE_TYPES = [...PARCEL_DRIVER_VEHICLE_TYPES];
const DOCS = [
  { id: 'nid', label: 'National ID / Passport' },
  { id: 'lic', label: "Driver's License" },
  { id: 'vreg', label: 'Vehicle Registration' },
  { id: 'pv', label: 'Profile Photo with Vehicle' },
];
const DEPOSIT = 10;

const STEP_LABELS = ['Personal Info', 'Vehicle Info', 'Documents'];

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M15.5 19.5L8 12l7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" aria-hidden>
      <rect x="2" y="6" width="20" height="13" rx="1.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M2 8V6a2 2 0 0 1 2-2h2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

function UplIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M12 16V5M7 8l5-3 5 3M4 20h16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M5 12.5l3.5 2.5 7.5-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StepCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
      <path
        d="M5 12.5l3 2.5 6.5-6"
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

function IconIdCard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="12" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M14 10h5M14 14h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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

function IconVehicle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 11h14l-1.5-4H6.5L5 11Zm0 0v5h2v-1.5M19 16v-1.5h2V16M7.5 16.5a1.5 1.5 0 1 0 0 .01M16.5 16.5a1.5 1.5 0 1 0 0 .01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTag() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12V6a2 2 0 0 1 2-2h6l8 8-8 8-8-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
    </svg>
  );
}

function StepProgress({ step }) {
  return (
    <div className="dp-reg-progress-track" aria-label={`Registration step ${step} of 3`}>
      {STEP_LABELS.map((label, i) => {
        const num = i + 1;
        const isDone = step > num;
        const isActive = step === num;
        const circleClass = isDone ? 'is-done' : isActive ? 'is-active' : 'is-upcoming';
        const labelClass = isDone ? 'is-done' : isActive ? 'is-active' : '';
        return (
          <Fragment key={label}>
            <div className="dp-reg-progress-node">
              <div className={`dp-reg-progress-circle ${circleClass}`}>
                {isDone ? <StepCheckIcon /> : num}
              </div>
              <span className={`dp-reg-progress-label ${labelClass}`}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`dp-reg-progress-line ${step > num ? 'is-done' : ''}`} aria-hidden />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function RegField({ label, htmlFor, icon: Icon, children }) {
  return (
    <div className="dp-reg-field">
      <label className="dp-reg-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="dp-reg-input-wrap">
        <span className="dp-reg-iconbox" aria-hidden>
          <Icon />
        </span>
        {children}
      </div>
    </div>
  );
}

const DRIVER_DOCS_BUCKET = 'driver-documents';

const initialFiles = () =>
  DOCS.reduce((a, d) => {
    a[d.id] = null;
    return a;
  }, {});

function safeStorageName(name) {
  const n = String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  return n.slice(0, 96) || 'file';
}

function extFromFile(file) {
  const n = file?.name || '';
  const i = n.lastIndexOf('.');
  if (i <= 0 || i === n.length - 1) return '';
  return n.slice(i);
}

/** Map UI doc id → DB column */
function docColumnForUiId(id) {
  if (id === 'nid') return 'doc_national_id_url';
  if (id === 'lic') return 'doc_license_url';
  if (id === 'vreg') return 'doc_vehicle_registration_url';
  if (id === 'pv') return 'doc_profile_with_vehicle_url';
  return null;
}

export default function DriverRegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    nationalId: '',
    password: '',
    confirm: '',
    countryIso: 'ZW',
    vehicleType: 'Motorbike',
    vMake: '',
    vModel: '',
    vPlate: '',
    vColor: '',
  });
  /** @type {{ [key: string]: { name: string, file: File } | null }} */
  const [docFiles, setDocFiles] = useState(() => initialFiles());
  /** Headshot step 1 — optional; saved as profile_photo_url */
  const [profilePhoto, setProfilePhoto] = useState(null);
  const fileRefs = useRef({});
  const profilePhotoInputRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(
    () => () => {
      if (profilePhoto?.previewUrl) URL.revokeObjectURL(profilePhoto.previewUrl);
    },
    [profilePhoto?.previewUrl],
  );

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const pick = (id) => {
    fileRefs.current[id]?.click();
  };
  const onFile = (id, e) => {
    const f = e.target.files?.[0];
    if (f) setDocFiles((d) => ({ ...d, [id]: { name: f.name, file: f } }));
  };

  const pickProfilePhoto = () => profilePhotoInputRef.current?.click();

  const onProfilePhotoChange = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith('image/')) {
      if (f && !f.type.startsWith('image/')) {
        e.target.value = '';
      }
      return;
    }
    setProfilePhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return { file: f, name: f.name, previewUrl: URL.createObjectURL(f) };
    });
    e.target.value = '';
  };

  const onProfilePhotoKeyDown = (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      pickProfilePhoto();
    }
  };

  const canNext1 =
    form.fullName &&
    form.phone &&
    form.email &&
    form.nationalId &&
    form.password &&
    form.password === form.confirm;
  const canNext2 = form.vMake && form.vModel && form.vPlate && form.vColor;
  const canSubmit = DOCS.every((d) => docFiles[d.id]?.file);

  const submitApplication = async () => {
    setErrorMessage('');
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured. Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY, then restart the dev server.');
      return;
    }
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const email = form.email.trim().toLowerCase();
      const uploadBatch = crypto.randomUUID();
      const docUrls = {};

      for (const d of DOCS) {
        const entry = docFiles[d.id];
        const col = docColumnForUiId(d.id);
        if (!entry?.file || !col) continue;
        const ext =
          extFromFile(entry.file) ||
          (entry.file.type === 'application/pdf' ? '.pdf' : '.jpg');
        const path = `applications/${uploadBatch}/${d.id}_${safeStorageName(entry.file.name.replace(/\.[^.]+$/, ''))}${ext}`;
        const { error: upErr } = await supabase.storage.from(DRIVER_DOCS_BUCKET).upload(path, entry.file, {
          cacheControl: '3600',
          upsert: true,
          contentType: entry.file.type || 'application/octet-stream',
        });
        if (upErr) {
          docUrls[col] = `pending:${entry.name}`;
        } else {
          const { data: pub } = supabase.storage.from(DRIVER_DOCS_BUCKET).getPublicUrl(path);
          docUrls[col] = pub?.publicUrl || `pending:${entry.name}`;
        }
      }

      let profilePhotoUrl = null;
      if (profilePhoto?.file) {
        const pf = profilePhoto.file;
        const ext = extFromFile(pf) || (pf.type === 'image/png' ? '.png' : '.jpg');
        const path = `applications/${uploadBatch}/profile_${safeStorageName(pf.name.replace(/\.[^.]+$/, ''))}${ext}`;
        const { error: pErr } = await supabase.storage.from(DRIVER_DOCS_BUCKET).upload(path, pf, {
          cacheControl: '3600',
          upsert: true,
          contentType: pf.type || 'image/jpeg',
        });
        if (pErr) {
          profilePhotoUrl = `pending:${profilePhoto.name}`;
        } else {
          const { data: pub } = supabase.storage.from(DRIVER_DOCS_BUCKET).getPublicUrl(path);
          profilePhotoUrl = pub?.publicUrl || `pending:${profilePhoto.name}`;
        }
      }

      const { data: inserted, error } = await supabase
        .from('driver_registrations')
        .insert({
          full_name: form.fullName.trim(),
          phone: form.phone.trim(),
          email,
          national_id: form.nationalId.trim(),
          password: form.password,
          phone_country_code: dialCodeForIso(form.countryIso),
          vehicle_type: form.vehicleType,
          vehicle_make: form.vMake.trim(),
          vehicle_model: form.vModel.trim(),
          vehicle_plate: form.vPlate.trim(),
          vehicle_color: form.vColor.trim(),
          deposit_required_gbp: DEPOSIT,
          profile_photo_url: profilePhotoUrl,
          doc_national_id_url: docUrls.doc_national_id_url ?? null,
          doc_license_url: docUrls.doc_license_url ?? null,
          doc_vehicle_registration_url: docUrls.doc_vehicle_registration_url ?? null,
          doc_profile_with_vehicle_url: docUrls.doc_profile_with_vehicle_url ?? null,
        })
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') {
          setErrorMessage('You already have a pending application with this email. Wait for review or contact support.');
        } else {
          setErrorMessage(error.message || 'Could not save your application. Please try again.');
        }
        return;
      }

      const send = await customerEmailVerifySend({ email, password: form.password, realm: 'driver' });
      if (!send.ok) {
        await supabase.from('driver_registrations').delete().eq('id', inserted.id);
        setErrorMessage(send.error || 'Could not send verification email. Try again in a moment.');
        return;
      }

      navigate(`/verify-email?realm=driver&email=${encodeURIComponent(email)}`, {
        replace: true,
        state: { codeSent: true },
      });
    } catch {
      setErrorMessage('Network error. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dp-reg-page">
      <header className="dp-reg-nav">
        <button
          type="button"
          className="dp-reg-nav-back"
          onClick={() => (step > 1 ? setStep((s) => s - 1) : navigate(-1))}
          aria-label="Back"
        >
          <BackIcon />
        </button>
        <h1 className="dp-reg-nav-title">Driver Registration</h1>
      </header>

      <div className="dp-reg-steps-panel">
        <p className="dp-reg-step-count">Step {step} of 3</p>
        <StepProgress step={step} />
      </div>

      <main className="dp-reg-main">
        <div className="dp-reg-card">
          {step === 1 && (
            <>
              <div className="dp-reg-photo">
                <input
                  ref={profilePhotoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  aria-label="Choose profile photo"
                  onChange={onProfilePhotoChange}
                />
                <div
                  className={
                    profilePhoto?.previewUrl
                      ? 'dp-reg-photo-circle dp-reg-photo-circle--has'
                      : 'dp-reg-photo-circle'
                  }
                  role="button"
                  tabIndex={0}
                  onClick={pickProfilePhoto}
                  onKeyDown={onProfilePhotoKeyDown}
                  aria-label={profilePhoto ? 'Change profile photo' : 'Add profile photo'}
                >
                  {profilePhoto?.previewUrl ? (
                    <img src={profilePhoto.previewUrl} alt="Profile preview" />
                  ) : (
                    <CamIcon />
                  )}
                </div>
                <button type="button" className="dp-reg-photo-btn" onClick={pickProfilePhoto}>
                  {profilePhoto ? 'Change photo' : 'Upload Photo'}
                </button>
                <p className="dp-reg-photo-hint">Tap to upload profile photo</p>
              </div>

              <RegField label="Full Name" htmlFor="dr-n" icon={IconPerson}>
                <input
                  className="dp-reg-input"
                  id="dr-n"
                  name="fullName"
                  value={form.fullName}
                  onChange={onChange}
                  autoComplete="name"
                  placeholder="Full name"
                />
              </RegField>

              <div className="dp-reg-field">
                <label className="dp-reg-label" htmlFor="dr-p">
                  Phone Number
                </label>
                <div className="dp-reg-phone-wrap">
                  <span className="dp-reg-iconbox" aria-hidden>
                    <IconPhone />
                  </span>
                  <select
                    className="dp-reg-phone-cc"
                    name="countryIso"
                    value={form.countryIso}
                    aria-label="Country calling code"
                    onChange={onChange}
                  >
                    {PHONE_COUNTRY_CODES.map((c) => (
                      <option key={c.iso} value={c.iso}>
                        {c.name} ({c.dial})
                      </option>
                    ))}
                  </select>
                  <input
                    className="dp-reg-phone-input"
                    id="dr-p"
                    name="phone"
                    value={form.phone}
                    onChange={onChange}
                    type="tel"
                    inputMode="numeric"
                    placeholder="300 1234567"
                    autoComplete="tel-national"
                  />
                </div>
              </div>

              <RegField label="Email Address" htmlFor="dr-e" icon={IconEnvelope}>
                <input
                  className="dp-reg-input"
                  id="dr-e"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={onChange}
                  autoComplete="email"
                  placeholder="you@email.com"
                />
              </RegField>

              <RegField label="National ID Number" htmlFor="dr-nid" icon={IconIdCard}>
                <input
                  className="dp-reg-input"
                  id="dr-nid"
                  name="nationalId"
                  value={form.nationalId}
                  onChange={onChange}
                  autoComplete="off"
                  placeholder="CNIC / ID number"
                />
              </RegField>

              <RegField label="Password" htmlFor="dr-pw1" icon={IconLock}>
                <input
                  className="dp-reg-input"
                  id="dr-pw1"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={onChange}
                  autoComplete="new-password"
                  placeholder="Create password"
                />
                <button
                  type="button"
                  className="dp-reg-input-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <IconEye open={!showPassword} />
                </button>
              </RegField>

              <RegField label="Confirm Password" htmlFor="dr-pw2" icon={IconLock}>
                <input
                  className="dp-reg-input"
                  id="dr-pw2"
                  name="confirm"
                  type={showConfirm ? 'text' : 'password'}
                  value={form.confirm}
                  onChange={onChange}
                  autoComplete="new-password"
                  placeholder="Confirm password"
                />
                <button
                  type="button"
                  className="dp-reg-input-toggle"
                  onClick={() => setShowConfirm((s) => !s)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  <IconEye open={!showConfirm} />
                </button>
              </RegField>

              {form.password && form.confirm && form.password !== form.confirm && (
                <p className="dp-reg-mismatch">Passwords do not match</p>
              )}

              <button type="button" className="dp-reg-btn-next" onClick={() => setStep(2)} disabled={!canNext1}>
                Next →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <RegField label="Vehicle Type" htmlFor="dr-vt" icon={IconVehicle}>
                <select
                  className="dp-reg-input"
                  id="dr-vt"
                  name="vehicleType"
                  value={form.vehicleType}
                  onChange={onChange}
                >
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {formatVehicleTypeForDisplay(v)}
                    </option>
                  ))}
                </select>
              </RegField>

              <RegField label="Vehicle Make" htmlFor="dr-vmk" icon={IconTag}>
                <input
                  className="dp-reg-input"
                  id="dr-vmk"
                  name="vMake"
                  value={form.vMake}
                  onChange={onChange}
                  placeholder="e.g. Honda"
                />
              </RegField>

              <RegField label="Vehicle Model" htmlFor="dr-vmd" icon={IconTag}>
                <input
                  className="dp-reg-input"
                  id="dr-vmd"
                  name="vModel"
                  value={form.vModel}
                  onChange={onChange}
                  placeholder="e.g. 125"
                />
              </RegField>

              <RegField label="Plate Number" htmlFor="dr-vpl" icon={IconTag}>
                <input
                  className="dp-reg-input"
                  id="dr-vpl"
                  name="vPlate"
                  value={form.vPlate}
                  onChange={onChange}
                  placeholder="e.g. ABC-2019"
                />
              </RegField>

              <RegField label="Vehicle Color" htmlFor="dr-vcl" icon={IconTag}>
                <input
                  className="dp-reg-input"
                  id="dr-vcl"
                  name="vColor"
                  value={form.vColor}
                  onChange={onChange}
                  placeholder="e.g. Red"
                />
              </RegField>

              <button type="button" className="dp-reg-btn-next" onClick={() => setStep(3)} disabled={!canNext2}>
                Next →
              </button>
            </>
          )}

          {step === 3 && (
            <>
              {errorMessage ? (
                <p className="dp-reg-error" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <h2 className="dp-reg-docs-title">Upload Your Documents</h2>

              {DOCS.map((d) => (
                <div key={d.id}>
                  <input
                    ref={(el) => {
                      fileRefs.current[d.id] = el;
                    }}
                    type="file"
                    accept="image/*,application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => onFile(d.id, e)}
                    aria-label={d.label}
                  />
                  <button
                    type="button"
                    className={
                      docFiles[d.id]?.file ? 'dp-reg-doc-btn dp-reg-doc-btn--ok' : 'dp-reg-doc-btn'
                    }
                    onClick={() => pick(d.id)}
                  >
                    {docFiles[d.id]?.file ? <CheckIcon /> : <UplIcon />}
                    <span className="dp-reg-doc-btn-label">{d.label}</span>
                    <span className="dp-reg-doc-btn-hint">Tap to upload</span>
                    {docFiles[d.id] && (
                      <span className="dp-reg-doc-btn-file">{docFiles[d.id].name}</span>
                    )}
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="dp-reg-btn-next"
                onClick={submitApplication}
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? 'Submitting…' : 'Submit Application'}
              </button>
              <p className="dp-reg-foot">Your application will be reviewed within 24 hours</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
