import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const KIND_TABS = ['All', 'Taxi', 'Tuk-tuk', 'Parcel', 'Shop'];

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function shortRef(prefix, id) {
  return `${prefix}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function byLabel(cancelledBy) {
  const b = String(cancelledBy || '').toLowerCase();
  if (b === 'driver') return 'Driver';
  if (b === 'customer') return 'Customer';
  if (b === 'system') return 'System';
  if (b === 'shop') return 'Shop';
  return cancelledBy || '—';
}

function byBadge(cancelledBy) {
  const b = String(cancelledBy || '').toLowerCase();
  if (b === 'driver') return 'admBadgeStatus admRed';
  if (b === 'customer') return 'admBadgeStatus admOrange';
  return 'admBadgeStatus admBlue';
}

function kindFromTab(tab) {
  if (tab === 'Taxi') return 'taxi';
  if (tab === 'Tuk-tuk') return 'tuk';
  if (tab === 'Parcel') return 'delivery';
  if (tab === 'Shop') return 'shop';
  return null;
}

export default function AdminCancelledRidesPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);

    const richTaxi =
      'id, app_user_id, assigned_driver_id, pickup_location, destination_location, quoted_price, status, cancel_reason, cancelled_by, cancelled_at, created_at';
    const richParcel =
      'id, app_user_id, assigned_driver_id, pickup_location, dropoff_location, total_amount, status, cancel_reason, cancelled_by, cancelled_at, created_at';
    const richShop =
      'id, assigned_driver_id, customer_name, customer_phone, customer_address, order_number, subtotal, status, cancel_reason, cancelled_by, cancelled_at, placed_at, created_at';

    let taxiRes = await supabase.from('taxi_bookings').select(richTaxi).eq('status', 'cancelled').order('created_at', { ascending: false }).limit(200);
    let tukRes = await supabase.from('tuk_tuk_bookings').select(richTaxi).eq('status', 'cancelled').order('created_at', { ascending: false }).limit(200);
    let parcelRes = await supabase
      .from('customer_delivery_orders')
      .select(richParcel)
      .eq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(200);
    let shopRes = await supabase
      .from('shop_customer_orders')
      .select(richShop)
      .eq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(100);

    const needsFallback = [taxiRes, tukRes, parcelRes, shopRes].some(
      (r) => r.error && /cancel_reason|cancelled_by|cancelled_at|column/i.test(r.error.message || ''),
    );

    if (needsFallback) {
      setError('Run supabase/booking_cancel_reason.sql so cancel reasons appear here.');
      taxiRes = await supabase
        .from('taxi_bookings')
        .select('id, app_user_id, assigned_driver_id, pickup_location, destination_location, quoted_price, status, created_at')
        .eq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(200);
      tukRes = await supabase
        .from('tuk_tuk_bookings')
        .select('id, app_user_id, assigned_driver_id, pickup_location, destination_location, quoted_price, status, created_at')
        .eq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(200);
      parcelRes = await supabase
        .from('customer_delivery_orders')
        .select('id, app_user_id, assigned_driver_id, pickup_location, dropoff_location, total_amount, status, created_at')
        .eq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(200);
      shopRes = await supabase
        .from('shop_customer_orders')
        .select('id, assigned_driver_id, customer_name, customer_phone, customer_address, order_number, subtotal, status, placed_at, created_at')
        .eq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(100);
    } else {
      const firstErr = taxiRes.error || tukRes.error || parcelRes.error || shopRes.error;
      if (firstErr) setError(firstErr.message);
    }

    const taxis = taxiRes.data || [];
    const tuks = tukRes.data || [];
    const parcels = parcelRes.data || [];
    const shops = shopRes.data || [];

    const driverIds = [
      ...taxis.map((r) => r.assigned_driver_id),
      ...tuks.map((r) => r.assigned_driver_id),
      ...parcels.map((r) => r.assigned_driver_id),
      ...shops.map((r) => r.assigned_driver_id),
    ].filter(Boolean);
    const userIds = [
      ...taxis.map((r) => r.app_user_id),
      ...tuks.map((r) => r.app_user_id),
      ...parcels.map((r) => r.app_user_id),
    ].filter(Boolean);

    const driverById = {};
    const userById = {};
    const uniqDrivers = [...new Set(driverIds)];
    const uniqUsers = [...new Set(userIds)];
    if (uniqDrivers.length) {
      const { data } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code')
        .in('id', uniqDrivers);
      for (const d of data || []) {
        driverById[d.id] = {
          name: d.full_name?.trim() || 'Driver',
          phone: [d.phone_country_code, d.phone].filter(Boolean).join(' ').trim() || '—',
        };
      }
    }
    if (uniqUsers.length) {
      const { data } = await supabase.from('app_users').select('id, full_name, phone').in('id', uniqUsers);
      for (const u of data || []) {
        userById[u.id] = { name: u.full_name?.trim() || 'Customer', phone: u.phone || '—' };
      }
    }

    const mapped = [
      ...taxis.map((r) => ({
        key: `taxi:${r.id}`,
        kind: 'taxi',
        kindLabel: 'Taxi',
        ref: shortRef('TXI', r.id),
        from: r.pickup_location || '—',
        to: r.destination_location || '—',
        amount: Number(r.quoted_price) || 0,
        reason: r.cancel_reason?.trim() || '—',
        cancelledBy: r.cancelled_by || '',
        cancelledAt: r.cancelled_at || r.created_at,
        customer: userById[r.app_user_id] || null,
        driver: driverById[r.assigned_driver_id] || null,
      })),
      ...tuks.map((r) => ({
        key: `tuk:${r.id}`,
        kind: 'tuk',
        kindLabel: 'Tuk-tuk',
        ref: shortRef('TUK', r.id),
        from: r.pickup_location || '—',
        to: r.destination_location || '—',
        amount: Number(r.quoted_price) || 0,
        reason: r.cancel_reason?.trim() || '—',
        cancelledBy: r.cancelled_by || '',
        cancelledAt: r.cancelled_at || r.created_at,
        customer: userById[r.app_user_id] || null,
        driver: driverById[r.assigned_driver_id] || null,
      })),
      ...parcels.map((r) => ({
        key: `delivery:${r.id}`,
        kind: 'delivery',
        kindLabel: 'Parcel',
        ref: shortRef('PCL', r.id),
        from: r.pickup_location || '—',
        to: r.dropoff_location || '—',
        amount: Number(r.total_amount) || 0,
        reason: r.cancel_reason?.trim() || '—',
        cancelledBy: r.cancelled_by || '',
        cancelledAt: r.cancelled_at || r.created_at,
        customer: userById[r.app_user_id] || null,
        driver: driverById[r.assigned_driver_id] || null,
      })),
      ...shops.map((r) => ({
        key: `shop:${r.id}`,
        kind: 'shop',
        kindLabel: 'Shop',
        ref: r.order_number || shortRef('SHP', r.id),
        from: 'Shop',
        to: r.customer_address || '—',
        amount: Number(r.subtotal) || 0,
        reason: r.cancel_reason?.trim() || '—',
        cancelledBy: r.cancelled_by || '',
        cancelledAt: r.cancelled_at || r.placed_at || r.created_at,
        customer: {
          name: r.customer_name?.trim() || 'Customer',
          phone: r.customer_phone || '—',
        },
        driver: driverById[r.assigned_driver_id] || null,
      })),
    ].sort((a, b) => new Date(b.cancelledAt || 0) - new Date(a.cancelledAt || 0));

    setRows(mapped);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSetAdminHeaderActions(<AdminHeaderRefresh onClick={load} disabled={loading} />);

  const filtered = useMemo(() => {
    const kind = kindFromTab(activeTab);
    let list = kind ? rows.filter((r) => r.kind === kind) : rows;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.ref, r.kindLabel, r.from, r.to, r.reason, r.cancelledBy, r.customer?.name, r.customer?.phone, r.driver?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, activeTab, search]);

  const driverCount = useMemo(
    () => filtered.filter((r) => String(r.cancelledBy || '').toLowerCase() === 'driver').length,
    [filtered],
  );

  return (
    <div className="adm">
      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318', fontWeight: 700 }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#b42318' }}>
          <p className="admDim" style={{ margin: 0 }}>
            Cancelled shown
          </p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '1.4rem', fontWeight: 800 }}>{filtered.length}</p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#ec6c23' }}>
          <p className="admDim" style={{ margin: 0 }}>
            Driver cancels
          </p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '1.4rem', fontWeight: 800 }}>{driverCount}</p>
        </article>
      </section>

      <section className="admTabs">
        {KIND_TABS.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search reason, customer, driver, route…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="admCard">
        {loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading cancelled rides…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem', margin: 0 }}>
            No cancelled rides match your filters.
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable admWideTable">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>By</th>
                  <th>Customer</th>
                  <th>Driver</th>
                  <th>When</th>
                  <th>Fare</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.key} className="admClickableRow" onClick={() => setSelected(r)}>
                    <td>
                      <button className="admLink" type="button">
                        {r.ref}
                      </button>
                    </td>
                    <td>
                      <span className="admBadgeStatus admBlue">{r.kindLabel}</span>
                    </td>
                    <td className="admDim" style={{ maxWidth: 240 }}>
                      {r.reason}
                    </td>
                    <td>
                      <span className={byBadge(r.cancelledBy)}>{byLabel(r.cancelledBy)}</span>
                    </td>
                    <td>{r.customer?.name || '—'}</td>
                    <td>{r.driver?.name || '—'}</td>
                    <td className="admDim">{formatDt(r.cancelledAt)}</td>
                    <td>{formatGBP(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <div className="admModalOverlay" role="presentation" onClick={() => setSelected(null)}>
          <div
            className="admModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="acr-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="acr-title" className="admModalTitle">
              {selected.ref}
            </h2>
            <p className="admDim" style={{ marginTop: 0 }}>
              {selected.kindLabel} · {byLabel(selected.cancelledBy)}
            </p>
            <p style={{ margin: '0.5rem 0', fontWeight: 700, color: '#b42318' }}>Reason: {selected.reason}</p>
            <p className="admDim" style={{ margin: '0.35rem 0' }}>
              From: {selected.from}
            </p>
            <p className="admDim" style={{ margin: '0.35rem 0' }}>
              To: {selected.to}
            </p>
            <p className="admDim" style={{ margin: '0.35rem 0' }}>
              Customer: {selected.customer?.name || '—'}
              {selected.customer?.phone ? ` · ${selected.customer.phone}` : ''}
            </p>
            <p className="admDim" style={{ margin: '0.35rem 0' }}>
              Driver: {selected.driver?.name || '—'}
              {selected.driver?.phone ? ` · ${selected.driver.phone}` : ''}
            </p>
            <p className="admDim" style={{ margin: '0.35rem 0' }}>
              When: {formatDt(selected.cancelledAt)}
            </p>
            <p className="admDim" style={{ margin: '0.35rem 0' }}>
              Fare: {formatGBP(selected.amount)}
            </p>
            <div className="admModalActions">
              <button type="button" className="admModalBtnGhost" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
