import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { shopOrderGrandTotal } from '../lib/shopDeliverySettings';
import { normalizeShopOrderStatus, shopOrderStatusLabel } from '../lib/shopOrderStatus';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const TABS = ['Pipeline', 'Awaiting driver', 'Active delivery', 'Delivered', 'All'];

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

function statusBadgeClass(status) {
  const s = normalizeShopOrderStatus(status);
  if (s === 'delivered') return 'admBadgeStatus admGreen';
  if (s === 'in transit') return 'admBadgeStatus admBlue';
  if (s === 'ready for delivery') return 'admBadgeStatus admOrange';
  if (s === 'picked up') return 'admBadgeStatus admBlue';
  if (s === 'cancelled') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admOrange';
}

function paymentShort(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'paid') return 'Paid';
  if (s === 'pending') return 'Pending';
  if (s === 'failed') return 'Failed';
  if (s === 'cancelled') return 'Cancelled';
  return raw ? String(raw) : '—';
}

function isPipelineStatus(status) {
  const s = normalizeShopOrderStatus(status);
  return s === 'ready for delivery' || s === 'picked up' || s === 'in transit' || s === 'delivered';
}

function pickupSummary(lines, ownersById) {
  const lids = [...new Set((lines || []).map((l) => l.shop_owner_id).filter(Boolean))];
  if (lids.length === 0) return '—';
  if (lids.length > 1) {
    return `${lids.length} shops (multi-vendor)`;
  }
  const o = ownersById[lids[0]];
  if (!o) return 'Shop (loading…)';
  const name = String(o.business_name || '').trim() || 'Shop';
  const addr = String(o.business_address || '').trim();
  return addr ? `${name} — ${addr}` : name;
}

function driverVehicleLine(d) {
  if (!d) return '';
  const plate = String(d.vehicle_plate || '').trim();
  const mk = [d.vehicle_make, d.vehicle_model].filter(Boolean).join(' ').trim();
  const vt = String(d.vehicle_type || '').trim();
  const bits = [vt, mk, plate].filter(Boolean);
  return bits.join(' · ') || '—';
}

export default function AdminShopOrdersDeliveryPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Pipeline');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: orderRows, error: oErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .order('placed_at', { ascending: false });

    if (oErr) {
      setRows([]);
      setError(
        oErr.message?.includes('shop_customer_orders')
          ? `${oErr.message} — Run shop_customer_orders.sql if the table is missing.`
          : oErr.message,
      );
      setLoading(false);
      return;
    }

    const orders = Array.isArray(orderRows) ? orderRows : [];
    const ids = orders.map((o) => o.id).filter(Boolean);

    let linesByOrder = {};
    const ownerIds = new Set();
    if (ids.length) {
      const { data: lines, error: lErr } = await supabase.from('shop_customer_order_lines').select('*').in('order_id', ids);
      if (lErr) {
        setRows([]);
        setError(lErr.message);
        setLoading(false);
        return;
      }
      for (const l of lines || []) {
        if (!linesByOrder[l.order_id]) linesByOrder[l.order_id] = [];
        linesByOrder[l.order_id].push(l);
        if (l.shop_owner_id) ownerIds.add(l.shop_owner_id);
      }
    }

    const ownerIdList = [...ownerIds];
    let ownersById = {};
    if (ownerIdList.length) {
      const { data: owners, error: ownErr } = await supabase
        .from('shop_owners')
        .select('id, business_name, business_address, owner_full_name, phone, email')
        .in('id', ownerIdList);
      if (!ownErr && Array.isArray(owners)) {
        ownersById = Object.fromEntries(owners.map((x) => [x.id, x]));
      }
    }

    const driverIds = [...new Set(orders.map((o) => o.assigned_driver_id).filter(Boolean))];
    let driversById = {};
    if (driverIds.length) {
      const { data: drList, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate')
        .in('id', driverIds);
      if (!dErr && Array.isArray(drList)) {
        driversById = Object.fromEntries(drList.map((d) => [d.id, d]));
      }
    }

    const merged = orders.map((o) => ({
      ...o,
      lines: linesByOrder[o.id] || [],
      driver: o.assigned_driver_id ? driversById[o.assigned_driver_id] ?? null : null,
      pickupLabel: pickupSummary(linesByOrder[o.id] || [], ownersById),
    }));

    setRows(merged);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
    }, 45000);
    return () => window.clearInterval(id);
  }, [load]);

  const stats = useMemo(() => {
    const pipeline = rows.filter((o) => isPipelineStatus(o.status) || o.assigned_driver_id);
    const awaiting = rows.filter(
      (o) => normalizeShopOrderStatus(o.status) === 'ready for delivery' && !o.assigned_driver_id,
    );
    const active = rows.filter((o) => {
      const s = normalizeShopOrderStatus(o.status);
      return o.assigned_driver_id && s !== 'delivered' && s !== 'cancelled';
    });
    const delivered = rows.filter((o) => normalizeShopOrderStatus(o.status) === 'delivered');
    return { pipeline: pipeline.length, awaiting: awaiting.length, active: active.length, delivered: delivered.length };
  }, [rows]);

  const filteredByTab = useMemo(() => {
    return rows.filter((o) => {
      const s = normalizeShopOrderStatus(o.status);
      const hasDriver = Boolean(o.assigned_driver_id);
      if (activeTab === 'All') return s !== 'cancelled';
      if (activeTab === 'Pipeline') return isPipelineStatus(o.status) || hasDriver;
      if (activeTab === 'Awaiting driver') return s === 'ready for delivery' && !hasDriver;
      if (activeTab === 'Active delivery') return hasDriver && s !== 'delivered' && s !== 'cancelled';
      if (activeTab === 'Delivered') return s === 'delivered';
      return true;
    });
  }, [rows, activeTab]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return filteredByTab;
    return filteredByTab.filter((o) => {
      const d = o.driver;
      const blob = [
        o.order_number,
        o.customer_full_name,
        o.customer_phone,
        o.customer_email,
        o.customer_address,
        o.pickupLabel,
        d?.full_name,
        d?.phone,
        d?.vehicle_plate,
        shopOrderStatusLabel(o.status),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [filteredByTab, search]);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <p className="admDim" style={{ margin: '0 0 0.85rem', maxWidth: '48rem', lineHeight: 1.45 }}>
        Driver-assigned shop deliveries: pickup at the shop address, drop-off at the customer. Use tabs to filter the
        queue. Run <code style={{ fontSize: '0.85em' }}>shop_customer_orders_driver_assignment.sql</code> if driver
        columns are missing.
      </p>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#F18631' }}>
          <h4>Pipeline</h4>
          <p className="v">{loading ? '…' : stats.pipeline}</p>
          <p className="s" style={{ color: '#A85612' }}>
            Ready → delivered (or assigned)
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#ea580c' }}>
          <h4>Awaiting driver</h4>
          <p className="v" style={{ color: '#c2410c' }}>
            {loading ? '…' : stats.awaiting}
          </p>
          <p className="s" style={{ color: '#9a3412' }}>
            Ready, not accepted yet
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Active delivery</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : stats.active}
          </p>
          <p className="s" style={{ color: '#2563eb' }}>
            Driver assigned, not completed
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Delivered</h4>
          <p className="v" style={{ color: '#08487f' }}>
            {loading ? '…' : stats.delivered}
          </p>
          <p className="s" style={{ color: '#166534' }}>
            Completed drop-offs
          </p>
        </article>
      </section>

      <section className="admTabs" style={{ marginBottom: '0.85rem' }}>
        {TABS.map((t) => (
          <button key={t} type="button" className={activeTab === t ? 'active' : ''} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search order #, customer, driver, phone, address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="admCard">
        {loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem', margin: 0 }}>
            No rows for this filter. Shop owners mark orders <strong>Ready for delivery</strong> before they appear in
            the driver queue.
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Customer</th>
                  <th>Customer phone</th>
                  <th>Customer email</th>
                  <th>Drop-off address</th>
                  <th>Pickup (shop)</th>
                  <th>Driver</th>
                  <th>Driver phone</th>
                  <th>Vehicle</th>
                  <th>Assigned</th>
                  <th>Completed</th>
                  <th>Rejections</th>
                  <th>Total</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const d = o.driver;
                  const rej = Array.isArray(o.rejected_driver_ids) ? o.rejected_driver_ids.length : 0;
                  const driverName = d?.full_name?.trim() || (o.assigned_driver_id ? 'Unknown driver' : '—');
                  return (
                    <tr key={o.id}>
                      <td>
                        <code style={{ fontWeight: 700 }}>{o.order_number}</code>
                      </td>
                      <td>
                        <span className={statusBadgeClass(o.status)}>{shopOrderStatusLabel(o.status)}</span>
                      </td>
                      <td className="admDim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                        {paymentShort(o.payment_status)}
                      </td>
                      <td>
                        <strong>{o.customer_full_name}</strong>
                        {o.customer_notes ? (
                          <div className="admDim" style={{ fontSize: '0.72rem', marginTop: 4, maxWidth: '12rem' }} title={o.customer_notes}>
                            Note: {String(o.customer_notes).slice(0, 80)}
                            {String(o.customer_notes).length > 80 ? '…' : ''}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{o.customer_phone}</td>
                      <td className="admDim" style={{ fontSize: '0.8rem', maxWidth: '10rem', wordBreak: 'break-all' }}>
                        {o.customer_email || '—'}
                      </td>
                      <td style={{ fontSize: '0.8rem', maxWidth: '14rem', lineHeight: 1.35 }} title={o.customer_address}>
                        {o.customer_address}
                      </td>
                      <td style={{ fontSize: '0.8rem', maxWidth: '16rem', lineHeight: 1.35 }} title={o.pickupLabel}>
                        {o.pickupLabel}
                      </td>
                      <td style={{ fontWeight: 700, fontSize: '0.86rem' }}>{driverName}</td>
                      <td className="admDim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                        {d?.phone ? `${d.phone_country_code ? `${d.phone_country_code} ` : ''}${d.phone}` : '—'}
                      </td>
                      <td className="admDim" style={{ fontSize: '0.78rem', maxWidth: '11rem' }} title={driverVehicleLine(d)}>
                        {driverVehicleLine(d)}
                      </td>
                      <td className="admDim" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {formatDt(o.assigned_at)}
                      </td>
                      <td className="admDim" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {formatDt(o.completed_at)}
                      </td>
                      <td style={{ textAlign: 'center' }}>{rej || '—'}</td>
                      <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatGBP(shopOrderGrandTotal(o))}</td>
                      <td className="admDim" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {formatDt(o.placed_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
