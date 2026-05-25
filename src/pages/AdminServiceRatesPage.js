import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const SERVICES = [
  { type: 'delivery_motorbike', label: 'Delivery — Motorbike' },
  { type: 'delivery_tuk_tuk', label: 'Delivery — Tuk-Tuk' },
  { type: 'delivery_car', label: 'Delivery — Car' },
  { type: 'parcel', label: 'Parcel' },
  { type: 'taxi', label: 'Taxi (ride)' },
  { type: 'tuk_tuk', label: 'Tuk-Tuk (ride)' },
];

function emptyForm() {
  return SERVICES.reduce((acc, { type }) => {
    acc[type] = { price_per_km: '', base_fare: '', service_fee: '' };
    return acc;
  }, {});
}

export default function AdminServiceRatesPage() {
  const [values, setValues] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastSaved, setLastSaved] = useState(null);

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setError('Database is not configured.');
      return;
    }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('service_pricing')
        .select('service_type, price_per_km, base_fare, service_fee, updated_at')
        .order('service_type');

      if (qErr) {
        setError(qErr.message);
        setLoading(false);
        return;
      }

      const next = emptyForm();
      (data || []).forEach((row) => {
        if (next[row.service_type] != null) {
          next[row.service_type] = {
            price_per_km: row.price_per_km != null ? String(row.price_per_km) : '',
            base_fare: row.base_fare != null ? String(row.base_fare) : '',
            service_fee: row.service_fee != null ? String(row.service_fee) : '',
          };
        }
      });
      setValues(next);
      const newest = data?.reduce(
        (max, r) => (r.updated_at && (!max || r.updated_at > max) ? r.updated_at : max),
        null,
      );
      setLastSaved(newest);
    } catch {
      setError('Could not load rates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (serviceType, field, raw) => {
    setValues((prev) => ({
      ...prev,
      [serviceType]: { ...prev[serviceType], [field]: raw },
    }));
  };

  const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setError('Database is not configured.');
      return;
    }

    const rows = [];
    for (const { type } of SERVICES) {
      const label = SERVICES.find((s) => s.type === type)?.label;
      const pk = parseNum(values[type].price_per_km);
      const bf = parseNum(values[type].base_fare);
      const sf = parseNum(values[type].service_fee);
      if (Number.isNaN(pk) || pk < 0) {
        setError(`${label}: enter a valid price per km (≥ 0).`);
        return;
      }
      if (Number.isNaN(bf) || bf < 0) {
        setError(`${label}: enter a valid base fare (≥ 0).`);
        return;
      }
      if (Number.isNaN(sf) || sf < 0) {
        setError(`${label}: enter a valid service fee (≥ 0).`);
        return;
      }
      rows.push({
        service_type: type,
        price_per_km: pk,
        base_fare: bf,
        service_fee: sf,
        currency: 'USD',
        updated_at: new Date().toISOString(),
      });
    }

    setSaving(true);
    try {
      const { error: upErr } = await supabase.from('service_pricing').upsert(rows, {
        onConflict: 'service_type',
      });
      if (upErr) {
        setError(upErr.message);
        setSaving(false);
        return;
      }
      setLastSaved(new Date().toISOString());
      await load();
    } catch {
      setError('Save failed. Check network and table policies.');
    } finally {
      setSaving(false);
    }
  };

  const subtitle = useMemo(() => {
    if (!lastSaved) return null;
    try {
      const d = new Date(lastSaved);
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return lastSaved;
    }
  }, [lastSaved]);

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Service rates</h2>
        <div className="admFilters" style={{ alignItems: 'center', gap: '0.75rem' }}>
          {subtitle ? (
            <small className="admDim">Last updated: {subtitle}</small>
          ) : (
            <small className="admDim">Set fare components per service</small>
          )}
        </div>
      </div>

      <section className="admWarnCard">
        <span style={{ color: '#ec9120', fontSize: '1.1rem' }} aria-hidden>
          ⚠
        </span>
        <div>
          <strong>Delivery rates are per vehicle</strong>
          <div style={{ color: '#cf7a16', marginTop: '0.2rem' }}>
            Set separate <strong>price per km</strong>, <strong>base fare</strong>, and <strong>service fee</strong> for
            each delivery class: <strong>Motorbike</strong>, <strong>Tuk-Tuk</strong>, and <strong>Car</strong>. The
            customer flow picks one of these on package details; the price estimate uses the matching row.{' '}
            <strong>Taxi (ride)</strong> and <strong>Tuk-Tuk (ride)</strong> are for ride bookings, not parcel delivery.
            Currency: USD.
          </div>
        </div>
      </section>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <form className="admCard" onSubmit={handleSave} style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader">
          <h3>Fare components</h3>
        </div>

        {loading ? (
          <p className="admDim">Loading…</p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Price per km (�$)</th>
                  <th>Base fare (�$)</th>
                  <th>Service fee (�$)</th>
                </tr>
              </thead>
              <tbody>
                {SERVICES.map(({ type, label }) => (
                  <tr key={type}>
                    <td>
                      <strong>{label}</strong>
                    </td>
                    <td>
                      <input
                        className="admInput"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={values[type]?.price_per_km ?? ''}
                        onChange={(ev) => setField(type, 'price_per_km', ev.target.value)}
                        aria-label={`${label} price per km`}
                      />
                    </td>
                    <td>
                      <input
                        className="admInput"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={values[type]?.base_fare ?? ''}
                        onChange={(ev) => setField(type, 'base_fare', ev.target.value)}
                        aria-label={`${label} base fare`}
                      />
                    </td>
                    <td>
                      <input
                        className="admInput"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={values[type]?.service_fee ?? ''}
                        onChange={(ev) => setField(type, 'service_fee', ev.target.value)}
                        aria-label={`${label} service fee`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button className="admBtn admBtnAuto" type="submit" disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="admOutlineGrayBtn" type="button" disabled={loading} onClick={() => load()}>
            Reload
          </button>
        </div>
      </form>
    </div>
  );
}
