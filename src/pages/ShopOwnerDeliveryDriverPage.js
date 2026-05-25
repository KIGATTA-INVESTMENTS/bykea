import { useCallback, useEffect, useState } from 'react';
import { formatGBP } from '../lib/currency';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerDeliveryDriverPremium.css';

const ACTIVE_STATUSES = ['ready for delivery', 'picked up', 'in transit'];

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function phaseLabel(status) {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'ready for delivery') return 'On the way to your shop';
  if (s === 'picked up') return 'Picked up';
  if (s === 'in transit') return 'Out for delivery';
  if (s === 'delivered') return 'Delivered';
  return String(status || '—');
}

function driverPhone(d) {
  if (!d?.phone) return '—';
  const cc = d.phone_country_code ? String(d.phone_country_code).trim() : '';
  return cc ? `${cc} ${d.phone}` : String(d.phone);
}

function IcInfo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden className="sodd-info-icon">
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M12 10.2V16M12 7.2v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IcNav() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M12 3v18M8 9l4-3 4 3M5 17h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IcRider() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="12" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcScooterEmpty() {
  return (
    <svg viewBox="0 0 88 72" width="88" height="72" fill="none" aria-hidden className="sodd-empty-icon">
      <circle cx="18" cy="58" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="62" cy="58" r="8" stroke="currentColor" strokeWidth="2" />
      <path
        d="M18 58h12l8-28h14l6 10h10M38 30h12l4 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M52 22h10v8H52z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function ShopOwnerDeliveryDriverPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    const session = getShopOwnerSession();
    if (!session?.id) {
      setRows([]);
      setErr('Sign in as a shop owner.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setErr('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data: lineRows, error: lErr } = await supabase
      .from('shop_customer_order_lines')
      .select('order_id, product_name, quantity, line_total')
      .eq('shop_owner_id', session.id);

    if (lErr) {
      setRows([]);
      setErr(lErr.message);
      setLoading(false);
      return;
    }

    const lines = Array.isArray(lineRows) ? lineRows : [];
    const orderIds = [...new Set(lines.map((l) => l.order_id).filter(Boolean))];
    if (!orderIds.length) {
      setRows([]);
      setLoading(false);
      return;
    }

    const linesByOrder = {};
    for (const l of lines) {
      if (!linesByOrder[l.order_id]) linesByOrder[l.order_id] = [];
      linesByOrder[l.order_id].push(l);
    }

    const { data: orders, error: oErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .in('id', orderIds)
      .not('assigned_driver_id', 'is', null)
      .in('status', ACTIVE_STATUSES);

    if (oErr) {
      setRows([]);
      setErr(
        oErr.message?.includes('assigned_driver_id')
          ? `${oErr.message} — Run supabase/shop_customer_orders_driver_assignment.sql.`
          : oErr.message,
      );
      setLoading(false);
      return;
    }

    const list = (orders || []).filter((o) => ACTIVE_STATUSES.includes(String(o.status || '').toLowerCase().trim()));
    const driverIds = [...new Set(list.map((o) => o.assigned_driver_id).filter(Boolean))];
    let driverById = {};
    if (driverIds.length) {
      const { data: drs, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_plate, vehicle_make, vehicle_model')
        .in('id', driverIds);
      if (!dErr && Array.isArray(drs)) {
        driverById = Object.fromEntries(drs.map((d) => [d.id, d]));
      }
    }

    const merged = list.map((o) => {
      const ol = linesByOrder[o.id] || [];
      const sub = ol.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      const items = ol.map((l) => `${l.product_name} ×${l.quantity}`).join(', ');
      const d = o.assigned_driver_id ? driverById[o.assigned_driver_id] : null;
      const veh = [d?.vehicle_type, d?.vehicle_make, d?.vehicle_model, d?.vehicle_plate].filter(Boolean).join(' · ');
      return {
        order: o,
        items,
        subtotal: sub,
        driver: d,
        vehicleLine: veh || '—',
        phase: phaseLabel(o.status),
      };
    });

    merged.sort((a, b) => new Date(b.order.assigned_at || b.order.placed_at || 0) - new Date(a.order.assigned_at || a.order.placed_at || 0));
    setRows(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
    }, 12000);
    return () => window.clearInterval(id);
  }, [load]);

  const headingCount = rows.filter((r) => String(r.order.status || '').toLowerCase().trim() === 'ready for delivery').length;
  const showEmpty = !loading && rows.length === 0;

  return (
    <div className="sodd-page">
      <div className="sodd-head">
        <h1>Delivery Drivers</h1>
        <span className="sodd-live-pill" role="status" aria-live="polite">
          <span className="sodd-live-dot" aria-hidden />
          LIVE
        </span>
      </div>

      <div className="sodd-info" role="note">
        <IcInfo />
        <p>Drivers who accepted your shop orders — live status (refreshes every ~12s)</p>
      </div>

      {err ? (
        <div className="sodd-error" role="alert">
          <p>{err}</p>
        </div>
      ) : null}

      <div className="sodd-stats" aria-label="Driver summary">
        <article className="sodd-stat">
          <span className="sodd-stat-icon sodd-stat-icon--orange" aria-hidden>
            <IcNav />
          </span>
          <p className="sodd-stat-label">Heading to your shop</p>
          <p className="sodd-stat-value sodd-stat-value--orange">{loading ? '…' : headingCount}</p>
          <p className="sodd-stat-foot">En route to pickup</p>
        </article>
        <article className="sodd-stat">
          <span className="sodd-stat-icon sodd-stat-icon--blue" aria-hidden>
            <IcRider />
          </span>
          <p className="sodd-stat-label">Active with driver</p>
          <p className="sodd-stat-value sodd-stat-value--blue">{loading ? '…' : rows.length}</p>
          <p className="sodd-stat-foot">Currently delivering</p>
        </article>
      </div>

      {loading && rows.length === 0 ? (
        <p className="sodd-loading">Loading…</p>
      ) : showEmpty ? (
        <div className="sodd-empty" role="status">
          <IcScooterEmpty />
          <h2>No drivers assigned yet</h2>
          <p>
            When you mark an order Ready for delivery and a driver accepts it, they will appear here while travelling
            to your shop.
          </p>
          <p className="sodd-empty-note">
            Mark orders as <span className="sodd-highlight">Ready for delivery</span> in My Orders when they are packed
            and ready for pickup.
          </p>
        </div>
      ) : (
        <div className="sodd-table-card">
          <div className="sodd-table-scroll">
            <table className="sodd-table" aria-label="Assigned drivers">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Stage</th>
                  <th>Driver</th>
                  <th>Driver phone</th>
                  <th>Vehicle</th>
                  <th>Customer</th>
                  <th>Drop-off</th>
                  <th>Your lines</th>
                  <th>Subtotal</th>
                  <th>Assigned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ order: o, items, subtotal, driver: d, vehicleLine, phase }) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.order_number}</strong>
                    </td>
                    <td>
                      <span className="sodd-phase-badge">{phase}</span>
                    </td>
                    <td>{d?.full_name?.trim() || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d ? driverPhone(d) : '—'}</td>
                    <td style={{ fontSize: '0.82rem', maxWidth: '12rem' }} title={vehicleLine}>
                      {vehicleLine}
                    </td>
                    <td>{o.customer_full_name}</td>
                    <td style={{ fontSize: '0.82rem', maxWidth: '14rem' }} title={o.customer_address}>
                      {o.customer_address}
                    </td>
                    <td style={{ fontSize: '0.8rem', maxWidth: '14rem' }} title={items}>
                      {items || '—'}
                    </td>
                    <td>{formatGBP(subtotal)}</td>
                    <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{formatDt(o.assigned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
