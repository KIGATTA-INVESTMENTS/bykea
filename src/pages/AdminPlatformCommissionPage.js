import { useCallback, useEffect, useMemo, useState } from 'react';
import { PLATFORM_COMMISSION_ROW_ID } from '../lib/platformCommissionSettings';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export default function AdminPlatformCommissionPage() {
  const [driverPct, setDriverPct] = useState('');
  const [shopPct, setShopPct] = useState('');
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
        .from('platform_commission_settings')
        .select('driver_commission_percent, shop_commission_percent, updated_at')
        .eq('id', PLATFORM_COMMISSION_ROW_ID)
        .maybeSingle();

      if (qErr) {
        setError(qErr.message);
        setLoading(false);
        return;
      }
      if (data) {
        setDriverPct(String(data.driver_commission_percent ?? ''));
        setShopPct(String(data.shop_commission_percent ?? ''));
        setLastSaved(data.updated_at || null);
      } else {
        setDriverPct('10');
        setShopPct('10');
        setLastSaved(null);
      }
    } catch {
      setError('Could not load commission settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parsePct = (s) => {
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
    const d = clampPct(parsePct(driverPct));
    const sh = clampPct(parsePct(shopPct));
    if (Number.isNaN(parsePct(driverPct)) || Number.isNaN(parsePct(shopPct))) {
      setError('Enter valid numbers for both percentages (0–100).');
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    try {
      const { error: upErr } = await supabase.from('platform_commission_settings').upsert(
        {
          id: PLATFORM_COMMISSION_ROW_ID,
          driver_commission_percent: d,
          shop_commission_percent: sh,
          currency: 'USD',
          updated_at: now,
        },
        { onConflict: 'id' },
      );
      if (upErr) {
        setError(upErr.message);
        setSaving(false);
        return;
      }
      setLastSaved(now);
      await load();
    } catch {
      setError('Save failed. Run platform_commission_settings.sql if the table is missing.');
    } finally {
      setSaving(false);
    }
  };

  const subtitle = useMemo(() => {
    if (!lastSaved) return null;
    try {
      return new Date(lastSaved).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return lastSaved;
    }
  }, [lastSaved]);

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Platform commission</h2>
        <div className="admFilters" style={{ alignItems: 'center', gap: '0.75rem' }}>
          {subtitle ? <small className="admDim">Last saved: {subtitle}</small> : <small className="admDim">Driver vs shop rates (%)</small>}
        </div>
      </div>

      <section className="admWarnCard">
        <span style={{ color: '#ec9120', fontSize: '1.1rem' }} aria-hidden>
          ⚠
        </span>
        <div>
          <strong>These percentages are stored in the database</strong>
          <div style={{ color: '#cf7a16', marginTop: '0.2rem' }}>
            <strong>Driver commission</strong> is the platform share on driver jobs (rides, parcels, etc.).{' '}
            <strong>Shop commission</strong> is the platform share on shop orders — wire each flow in app logic where payouts are calculated.
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
          <h3>Commission rates</h3>
        </div>
        <p className="admDim" style={{ marginTop: 0 }}>
          Values are percentages from 0 to 100 (e.g. 12.5 means 12.5% of the relevant order total).
        </p>

        {loading ? (
          <p className="admDim">Loading…</p>
        ) : (
          <div className="admGrid2" style={{ marginTop: '0.75rem' }}>
            <article className="admCard" style={{ margin: 0, boxShadow: 'none', border: '1px solid #e8e8e8' }}>
              <div className="admSectionHeader">
                <h3 style={{ fontSize: '1rem' }}>Drivers</h3>
              </div>
              <div className="admField">
                <label htmlFor="adm-driver-pct">Platform commission on driver earnings (%)</label>
                <input
                  id="adm-driver-pct"
                  className="admInput"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={driverPct}
                  onChange={(ev) => setDriverPct(ev.target.value)}
                  aria-describedby="adm-driver-help"
                />
                <p id="adm-driver-help" className="admDim" style={{ margin: '0.35rem 0 0', fontSize: '0.82rem' }}>
                  Applied when calculating driver net pay from gross job totals (e.g. driver earnings screen).
                </p>
              </div>
            </article>
            <article className="admCard" style={{ margin: 0, boxShadow: 'none', border: '1px solid #e8e8e8' }}>
              <div className="admSectionHeader">
                <h3 style={{ fontSize: '1rem' }}>Shops</h3>
              </div>
              <div className="admField">
                <label htmlFor="adm-shop-pct">Platform commission on shop orders (%)</label>
                <input
                  id="adm-shop-pct"
                  className="admInput"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={shopPct}
                  onChange={(ev) => setShopPct(ev.target.value)}
                  aria-describedby="adm-shop-help"
                />
                <p id="adm-shop-help" className="admDim" style={{ margin: '0.35rem 0 0', fontSize: '0.82rem' }}>
                  Applied when calculating platform take from shop customer orders before shop payout.
                </p>
              </div>
            </article>
          </div>
        )}

        <div style={{ marginTop: '1.1rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
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
