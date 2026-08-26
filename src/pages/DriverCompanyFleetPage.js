import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import {
  ACCOUNT_MODE_COMPANY_OWNER,
  addCompanyFleetBike,
  emptyFleetBikeDraft,
  fetchCompanyFleetDashboard,
  fetchCompanyForOwner,
  validateFleetBikeDraft,
} from '../lib/driverCompany';
import { getDriverSession } from '../lib/driverSession';
import { sanitizePhoneInput } from '../lib/accountFieldValidation';
import { PARCEL_DRIVER_VEHICLE_TYPES } from '../lib/deliveryVehicleTypes';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './driverCompanyFleet.css';

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function DriverCompanyFleetPage() {
  const session = getDriverSession();
  const [company, setCompany] = useState(null);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [bikeDraft, setBikeDraft] = useState(() => emptyFleetBikeDraft(0));
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [formOk, setFormOk] = useState('');

  const isOwner = String(session?.account_mode || '') === ACCOUNT_MODE_COMPANY_OWNER || Boolean(session?.company_id);

  const load = useCallback(async () => {
    setError('');
    if (!session?.id) {
      setError('Sign in as a company owner to view your fleet.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    let co = null;
    if (session.company_id) {
      const { data } = await supabase.from('driver_companies').select('*').eq('id', session.company_id).maybeSingle();
      co = data;
    }
    if (!co) co = await fetchCompanyForOwner(session.id);
    setCompany(co);
    if (!co?.id) {
      setDash(null);
      setError('No delivery company is linked to this account. Register as a company owner, or run supabase/driver_companies_fleet.sql.');
      setLoading(false);
      return;
    }
    const snapshot = await fetchCompanyFleetDashboard(co.id);
    setDash(snapshot);
    setLoading(false);
  }, [session?.id, session?.company_id]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = dash?.totals;

  const setBikeField = (key) => (e) => {
    const value = key === 'bikerPhone' ? sanitizePhoneInput(e.target.value) : e.target.value;
    setBikeDraft((b) => ({ ...b, [key]: value }));
  };

  const onAddBike = async (e) => {
    e.preventDefault();
    setFormErr('');
    setFormOk('');
    if (!company?.id) return;
    const v = validateFleetBikeDraft(bikeDraft, 0);
    if (v) {
      setFormErr(v);
      return;
    }
    setBusy(true);
    const result = await addCompanyFleetBike({
      companyId: company.id,
      ownerEmail: session?.email || company.email || '',
      companySlug: company.company_name || 'fleet',
      bike: bikeDraft,
      phoneCountryCode: session?.phone_country_code || '+263',
    });
    setBusy(false);
    if (!result.ok) {
      setFormErr(result.error || 'Could not add bike.');
      return;
    }
    setFormOk(`Bike ${bikeDraft.vPlate} added. Biker login email: ${result.driver?.email}`);
    setBikeDraft(emptyFleetBikeDraft(Date.now()));
    setShowAdd(false);
    await load();
  };

  if (!isOwner && !loading) {
    return (
      <div className="dcf-page">
        <h1>Fleet</h1>
        <p className="dcf-muted">This screen is for delivery company owners.</p>
        <Link to="/driver/home" className="dcf-link">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="dcf-page">
      <header className="dcf-head">
        <div>
          <p className="dcf-eyebrow">Delivery company</p>
          <h1>{company?.company_name || 'Your fleet'}</h1>
          <p className="dcf-muted">{company?.trading_name ? `Trading as ${company.trading_name}` : 'Oversight for all your bikes'}</p>
        </div>
        <button type="button" className="dcf-btn" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Close' : 'Add bike'}
        </button>
      </header>

      {error ? (
        <p className="dcf-alert" role="alert">
          {error}
        </p>
      ) : null}
      {formOk ? (
        <p className="dcf-ok" role="status">
          {formOk}
        </p>
      ) : null}

      {loading ? (
        <p className="dcf-muted">Loading fleet…</p>
      ) : (
        <>
          <section className="dcf-stats" aria-label="Fleet summary">
            <article>
              <p className="dcf-stat-label">Bikes</p>
              <p className="dcf-stat-value">{totals?.bikeCount ?? 0}</p>
            </article>
            <article>
              <p className="dcf-stat-label">Active jobs</p>
              <p className="dcf-stat-value">{totals?.activeCount ?? 0}</p>
            </article>
            <article>
              <p className="dcf-stat-label">Completed</p>
              <p className="dcf-stat-value">{totals?.completedCount ?? 0}</p>
            </article>
            <article>
              <p className="dcf-stat-label">Net earned</p>
              <p className="dcf-stat-value">{formatGBP(totals?.net || 0)}</p>
            </article>
          </section>

          {showAdd ? (
            <form className="dcf-card dcf-form" onSubmit={onAddBike}>
              <h2>Register a bike &amp; biker</h2>
              <p className="dcf-muted">
                Enter this biker&apos;s own email and password. They will log in at Driver Login with those credentials
                after admin approval.
              </p>
              <label>
                Biker name
                <input value={bikeDraft.bikerName} onChange={setBikeField('bikerName')} required />
              </label>
              <label>
                Biker phone
                <input value={bikeDraft.bikerPhone} onChange={setBikeField('bikerPhone')} inputMode="tel" required />
              </label>
              <label>
                Biker login email
                <input
                  type="email"
                  value={bikeDraft.bikerEmail}
                  onChange={setBikeField('bikerEmail')}
                  placeholder="Their own unique email"
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Biker login password
                <input
                  type="password"
                  value={bikeDraft.bikerPassword}
                  onChange={setBikeField('bikerPassword')}
                  minLength={6}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                Vehicle type
                <select value={bikeDraft.vehicleType} onChange={setBikeField('vehicleType')}>
                  {PARCEL_DRIVER_VEHICLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dcf-grid2">
                <label>
                  Make
                  <input value={bikeDraft.vMake} onChange={setBikeField('vMake')} required />
                </label>
                <label>
                  Model
                  <input value={bikeDraft.vModel} onChange={setBikeField('vModel')} required />
                </label>
              </div>
              <div className="dcf-grid2">
                <label>
                  Plate
                  <input value={bikeDraft.vPlate} onChange={setBikeField('vPlate')} required />
                </label>
                <label>
                  Colour
                  <input value={bikeDraft.vColor} onChange={setBikeField('vColor')} required />
                </label>
              </div>
              {formErr ? (
                <p className="dcf-alert" role="alert">
                  {formErr}
                </p>
              ) : null}
              <button type="submit" className="dcf-btn dcf-btn--primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save bike'}
              </button>
            </form>
          ) : null}

          <section className="dcf-card">
            <h2>Your bikes</h2>
            {!dash?.bikes?.length ? (
              <p className="dcf-muted">No bikes yet. Add your first bike to start oversight.</p>
            ) : (
              <ul className="dcf-bike-list">
                {dash.bikes.map((b) => (
                  <li key={b.id} className="dcf-bike">
                    <div className="dcf-bike__top">
                      <strong>{b.biker_name}</strong>
                      <span className="dcf-pill">{b.vehicle_plate}</span>
                    </div>
                    <p className="dcf-muted">
                      {b.vehicle_type} · {b.vehicle_make} {b.vehicle_model} · {b.vehicle_color}
                    </p>
                    <p className="dcf-muted">
                      Login email: <strong>{b.biker_email || '—'}</strong>
                      {b.biker_phone ? ` · ${b.biker_phone}` : ''}
                    </p>
                    <p className="dcf-muted dcf-login-hint">Uses Driver Login with their email + password</p>
                    <div className="dcf-bike__stats">
                      <span>Active: {b.activeJobs?.length || 0}</span>
                      <span>Done: {b.completedCount}</span>
                      <span>Net: {formatGBP(b.netEarned)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dcf-card">
            <h2>Active deliveries</h2>
            {!dash?.activeJobs?.length ? (
              <p className="dcf-muted">No bikes are on a job right now.</p>
            ) : (
              <ul className="dcf-job-list">
                {dash.activeJobs.map((j) => (
                  <li key={`${j.bikeId}-${j.id || j.ref}`}>
                    <strong>{j.bikerName}</strong> · {j.plate}
                    <div className="dcf-muted">
                      {j.kind || j.bookingKind || 'Job'} → {j.to || j.dropoff || j.destination || '—'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dcf-card">
            <h2>Recent completed orders</h2>
            {!dash?.recentCompleted?.length ? (
              <p className="dcf-muted">No completed jobs yet for this fleet.</p>
            ) : (
              <ul className="dcf-job-list">
                {dash.recentCompleted.map((j) => (
                  <li key={`${j.bikeId}-${j.id}-${j.at}`}>
                    <strong>{j.bikerName}</strong> · {j.ref} · {formatGBP(j.amount)}
                    <div className="dcf-muted">
                      {formatDt(j.at)} · {j.plate} · {j.kind}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="dcf-muted" style={{ marginTop: '1rem' }}>
            Gross fleet: {formatGBP(totals?.gross || 0)} · Net (after platform commission estimate):{' '}
            {formatGBP(totals?.net || 0)}
          </p>
        </>
      )}
    </div>
  );
}
