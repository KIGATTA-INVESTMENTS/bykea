import { useCallback, useEffect, useMemo, useState } from 'react';
import { SHOP_DELIVERY_SETTINGS_ID } from '../lib/shopDeliverySettings';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

export default function AdminShopDeliveryPricePage() {
  const [fee, setFee] = useState('');
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
        .select('delivery_fee, currency, updated_at')
        .eq('id', SHOP_DELIVERY_SETTINGS_ID)
        .maybeSingle();

      if (qErr) {
        setError(qErr.message);
        setLoading(false);
        return;
      }
      if (data) {
        setFee(String(data.delivery_fee ?? ''));
        setLastSaved(data.updated_at || null);
      } else {
        setFee('2.99');
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
    const amount = parseMoney(fee);
    if (Number.isNaN(amount) || amount < 0) {
      setError('Enter a valid delivery cost (0 or more).');
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    try {
      const { error: upErr } = await supabase.from('shop_delivery_settings').upsert(
        {
          id: SHOP_DELIVERY_SETTINGS_ID,
          delivery_fee: amount,
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
            <small className="admDim">Flat fee added at shop checkout</small>
          )}
        </div>
      </div>

      <section className="admCard" style={{ maxWidth: '28rem' }}>
        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#444', lineHeight: 1.5 }}>
          This amount appears on the customer <strong>Checkout</strong> page as <strong>Delivery</strong> and is included in the
          order total. Changing it only affects <em>new</em> orders; completed orders keep the fee that was saved when they were
          placed.
        </p>

        {loading ? (
          <p className="admDim">Loading…</p>
        ) : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#333' }}>Delivery cost (USD)</span>
              <input
                type="text"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="e.g. 2.99"
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
