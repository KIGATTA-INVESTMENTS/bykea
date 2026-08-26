import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MAX_REASONABLE_SHOP_PER_KM_USD,
  SHOP_DELIVERY_SETTINGS_ID,
} from '../lib/shopDeliverySettings';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

export default function AdminShopDeliveryPricePage() {
  const [perKm, setPerKm] = useState('');
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
        .from('shop_delivery_settings')
        .select('delivery_fee_per_km, price_per_km, currency, updated_at')
        .eq('id', SHOP_DELIVERY_SETTINGS_ID)
        .maybeSingle();

      if (qErr) {
        if (/delivery_fee_per_km|schema cache/i.test(qErr.message || '')) {
          setError('Run supabase/shop_delivery_settings_per_km.sql in the SQL editor, then refresh.');
        } else {
          setError(qErr.message);
        }
        setLoading(false);
        return;
      }
      if (data) {
        setPerKm(String(data.delivery_fee_per_km ?? data.price_per_km ?? ''));
        setLastSaved(data.updated_at || null);
      } else {
        setPerKm('1.00');
        setLastSaved(null);
      }
    } catch {
      setError('Could not load shop delivery settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parseMoney = (s) => {
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
    const perKmAmount = parseMoney(perKm);
    if (Number.isNaN(perKmAmount) || perKmAmount < 0) {
      setError('Enter a valid price per km (0 or more).');
      return;
    }
    if (perKmAmount > MAX_REASONABLE_SHOP_PER_KM_USD) {
      setError(
        `Price per km looks too high (max $${MAX_REASONABLE_SHOP_PER_KM_USD}/km). Check you are not entering a flat delivery fee.`,
      );
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    try {
      const { error: upErr } = await supabase.from('shop_delivery_settings').upsert(
        {
          id: SHOP_DELIVERY_SETTINGS_ID,
          delivery_fee: 0,
          delivery_fee_per_km: perKmAmount,
          price_per_km: perKmAmount,
          currency: 'USD',
          updated_at: now,
        },
        { onConflict: 'id' },
      );
      if (upErr) {
        if (/delivery_fee_per_km|schema cache/i.test(upErr.message || '')) {
          setError('Run supabase/shop_delivery_settings_per_km.sql in the SQL editor, then save again.');
        } else {
          setError(upErr.message);
        }
        setSaving(false);
        return;
      }
      setLastSaved(now);
      await load();
    } catch {
      setError('Save failed. Run supabase/shop_delivery_settings.sql if the table is missing.');
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
        <h2 style={{ margin: 0 }}>Shop delivery price</h2>
        <div className="admFilters" style={{ alignItems: 'center', gap: '0.75rem' }}>
          {subtitle ? (
            <small className="admDim">Last saved: {subtitle}</small>
          ) : (
            <small className="admDim">Per-km rate at shop checkout</small>
          )}
        </div>
      </div>

      <section className="admCard" style={{ maxWidth: '32rem' }}>
        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#444', lineHeight: 1.5 }}>
          Checkout calculates <strong>Delivery</strong> as{' '}
          <em>distance from shop to customer (km) × this price per km</em>. Example: 2.5 km × $1.00 = $2.50. Do{' '}
          <strong>not</strong> enter a flat delivery total here. Max ${MAX_REASONABLE_SHOP_PER_KM_USD}/km.
        </p>

        {loading ? (
          <p className="admDim">Loading…</p>
        ) : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#333' }}>Price per km (USD)</span>
              <input
                type="text"
                inputMode="decimal"
                value={perKm}
                onChange={(e) => setPerKm(e.target.value)}
                placeholder="e.g. 1.00"
                style={{
                  padding: '0.55rem 0.65rem',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  fontSize: '1rem',
                  maxWidth: '12rem',
                }}
              />
            </label>

            {error ? (
              <p style={{ margin: 0, color: '#b71c1c', fontSize: '0.85rem', fontWeight: 600 }}>{error}</p>
            ) : null}

            <button type="submit" className="admBtn admBtnAuto" disabled={saving} style={{ alignSelf: 'flex-start' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
