import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PackagePhotoCapture from '../components/PackagePhotoCapture';
import { friendlyAppUserFkError, getCustomerSession, resolveValidAppUserId } from '../lib/customerSession';
import { CUSTOMER_PARCEL_VEHICLE_OPTIONS } from '../lib/deliveryVehicleTypes';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './bookRide.css';

function BackArrow() {
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

const SIZES = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'xlarge', label: 'Extra Large' },
];

function IconEnvelope() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <rect x="3" y="6" width="26" height="20" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M3 8l13 8 13-8" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
function IconBoxSm() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <rect x="5" y="8" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M5 12h14" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
function IconBoxLg() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <rect x="3" y="4" width="20" height="20" rx="1.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M3 10h20" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
function IconPallet() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <rect x="2" y="18" width="28" height="4" rx="0.5" fill="currentColor" />
      <rect x="4" y="6" width="8" height="10" stroke="currentColor" strokeWidth="1" fill="none" />
      <rect x="20" y="6" width="8" height="10" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

const sizeIcon = {
  small: IconEnvelope,
  medium: IconBoxSm,
  large: IconBoxLg,
  xlarge: IconPallet,
};

const PACKAGE_TYPE_OPTIONS = [
  'Documents',
  'Electronics',
  'Clothing',
  'Food',
  'Fragile',
  'Other',
];

export default function PackageDetailsPage() {
  const navigate = useNavigate();
  const { state: routeState = {} } = useLocation();
  const [size, setSize] = useState('medium');
  const [weight, setWeight] = useState('');
  const [typeCategory, setTypeCategory] = useState('Documents');
  const [typeOther, setTypeOther] = useState('');
  const existingPkg = routeState.package && typeof routeState.package === 'object' ? routeState.package : {};
  const [fileName, setFileName] = useState(typeof existingPkg.fileName === 'string' ? existingPkg.fileName : '');
  const [photoDataUrl, setPhotoDataUrl] = useState(
    typeof existingPkg.photoDataUrl === 'string' && existingPkg.photoDataUrl.startsWith('data:image/')
      ? existingPkg.photoDataUrl
      : null,
  );
  const [notes, setNotes] = useState('');
  const [requestedVehicleType, setRequestedVehicleType] = useState('Motorbike');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const onContinue = async (e) => {
    e.preventDefault();
    setSaveError('');
    const pickup = String(routeState.pickup || '').trim();
    const stops = Array.isArray(routeState.stops) ? routeState.stops : [];
    const dropTexts = stops.map((s) => String(s?.value ?? '').trim()).filter(Boolean);
    const dropoff = dropTexts[0] || '';
    const extraStops = dropTexts.slice(1).map((address) => ({ address }));

    if (typeCategory === 'Other' && !typeOther.trim()) {
      setSaveError('Please describe your package type when you choose Other.');
      return;
    }

    const resolvedType = typeCategory === 'Other' ? typeOther.trim() : typeCategory;

    const pkg = { size, weight, type: resolvedType, notes, fileName, photoDataUrl, requestedVehicleType };
    let deliveryRequestId = routeState.deliveryRequestId;

    if (pickup && dropoff && isSupabaseConfigured && supabase) {
      setIsSaving(true);
      try {
        const session = getCustomerSession();
        const appUserId = await resolveValidAppUserId(supabase, session?.id);
        const insertRow = {
          app_user_id: appUserId,
          pickup_location: pickup,
          dropoff_location: dropoff,
          extra_stops: extraStops,
          delivery_type: String(routeState.deliveryType || 'standard'),
          distance_estimate: routeState.distanceKm != null ? String(routeState.distanceKm) : null,
          package_size: size,
          package_weight: weight.trim() || null,
          package_category: resolvedType || null,
          package_notes: notes.trim() || null,
          package_photo_filename: fileName.trim() || null,
          package_photo_data_url: photoDataUrl || null,
          requested_vehicle_type: requestedVehicleType.trim(),
        };

        let { data: insertedReq, error } = await supabase
          .from('delivery_requests')
          .insert(insertRow)
          .select('id')
          .single();

        if (error && /package_photo_data_url/i.test(error.message || '')) {
          const { package_photo_data_url: _omit, ...withoutPhoto } = insertRow;
          ({ data: insertedReq, error } = await supabase
            .from('delivery_requests')
            .insert(withoutPhoto)
            .select('id')
            .single());
        }

        if (error && /app_user_id_fkey|foreign key constraint.*app_user/i.test(error.message || '')) {
          ({ data: insertedReq, error } = await supabase
            .from('delivery_requests')
            .insert({ ...insertRow, app_user_id: null })
            .select('id')
            .single());
        }

        if (error) {
          setSaveError(friendlyAppUserFkError(error.message));
          setIsSaving(false);
          return;
        }
        if (insertedReq?.id) deliveryRequestId = insertedReq.id;
      } catch {
        setSaveError('Network error while saving.');
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    navigate('/price-estimate', {
      state: {
        ...routeState,
        package: pkg,
        deliveryRequestId,
      },
    });
  };

  return (
    <form id="pd-form" className="br-page br-page--form" onSubmit={onContinue}>
      <header className="br-nav br-nav--stacked">
        <Link to="/request-delivery" className="br-nav__back" aria-label="Back to request delivery">
          <BackArrow />
        </Link>
        <div className="br-nav__center">
          <h1 className="br-nav__title">Package Details</h1>
          <p className="br-nav__step">Step 2 of 3</p>
        </div>
        <span className="br-nav__spacer" aria-hidden />
      </header>

      <div className="br-scroll br-scroll--form">
        <section className="br-pd-card" aria-label="Package size">
          <h2 className="br-pd-heading">Package size</h2>
          <p className="br-pd-hint">Select one size for your parcel.</p>
          <div className="br-pd-grid br-pd-grid--4" role="radiogroup" aria-label="Package size">
            {SIZES.map((s) => {
              const IconC = sizeIcon[s.id] || IconBoxSm;
              const on = size === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={on ? 'br-tier br-tier--active br-pd-pick' : 'br-tier br-pd-pick'}
                  onClick={() => setSize(s.id)}
                  role="radio"
                  aria-checked={on}
                >
                  <span className="br-tier__icon br-pd-pick__icon">
                    <IconC />
                  </span>
                  <span className="br-tier__label">{s.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="br-pd-card" aria-label="Vehicle size">
          <h2 className="br-pd-heading">Vehicle size needed</h2>
          <p className="br-pd-hint">
            Pick the smallest vehicle that fits. Drivers with that type or a larger one can accept your delivery.
          </p>
          <div className="br-pd-grid br-pd-grid--3" role="radiogroup" aria-label="Minimum vehicle size for delivery">
            {CUSTOMER_PARCEL_VEHICLE_OPTIONS.map((o) => {
              const on = requestedVehicleType === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  className={on ? 'br-tier br-tier--active br-pd-pick br-pd-pick--text' : 'br-tier br-pd-pick br-pd-pick--text'}
                  onClick={() => setRequestedVehicleType(o.value)}
                  role="radio"
                  aria-checked={on}
                >
                  <span className="br-tier__label">{o.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="br-pd-card">
          <h2 className="br-pd-heading">Package weight</h2>
          <div className="br-pd-field">
            <input
              className="br-pd-input"
              type="text"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0.0"
              autoComplete="off"
              aria-label="Weight in kilograms"
            />
            <span className="br-pd-field__suffix">kg</span>
          </div>
        </section>

        <section className="br-pd-card">
          <h2 className="br-pd-heading">Package type</h2>
          <p className="br-pd-hint">
            Choose a category. If you pick Other, describe what you are sending below.
          </p>
          <div className="br-pd-select-wrap">
            <select
              className="br-pd-select"
              value={typeCategory}
              onChange={(e) => setTypeCategory(e.target.value)}
              aria-label="Package type category"
            >
              {PACKAGE_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          {typeCategory === 'Other' ? (
            <div className="br-pd-field br-pd-field--mt">
              <input
                className="br-pd-input"
                type="text"
                value={typeOther}
                onChange={(e) => setTypeOther(e.target.value)}
                placeholder="e.g. Medical supplies, pet food, tools"
                autoComplete="off"
                maxLength={200}
                aria-label="Describe your package type"
              />
            </div>
          ) : null}
        </section>

        <section className="br-pd-card">
          <h2 className="br-pd-heading">Package photo</h2>
          <PackagePhotoCapture
            value={photoDataUrl}
            onChange={(url, name) => {
              setSaveError('');
              setPhotoDataUrl(url);
              setFileName(url ? name || 'package.jpg' : '');
            }}
            hint="Take or upload a photo of the parcel. The driver will see this at pickup."
          />
        </section>

        <section className="br-pd-card">
          <h2 className="br-pd-heading">Special instructions</h2>
          <textarea
            className="br-pd-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any handling instructions?"
            autoComplete="off"
            maxLength={500}
          />
        </section>

        {saveError ? (
          <p className="br-pd-error" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>

      <div className="br-footer">
        <button type="submit" className="br-confirm" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
