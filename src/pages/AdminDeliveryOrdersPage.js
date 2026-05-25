import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderOutlineBtn, AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const tabs = ['All', 'Placed', 'Paid'];

function shortOrderRef(uuid) {
  if (!uuid) return '—';
  const short = String(uuid).replace(/-/g, '').slice(0, 10).toUpperCase();
  return `ING-${short}`;
}

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

function paymentLabel(method) {
  if (method === 'ecocash') return 'Bank transfer';
  if (method === 'card') return 'Paynow';
  if (method === 'stripe') return 'Card';
  if (method === 'cod') return 'Cash on delivery';
  return method || '—';
}

function paymentShort(method) {
  if (method === 'ecocash') return 'Bank';
  if (method === 'card') return 'Paynow';
  if (method === 'stripe') return 'Card';
  if (method === 'cod') return 'Cash';
  return paymentLabel(method);
}

function extraStopsLabel(raw) {
  if (raw == null) return '';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '';
    return raw.map((s, i) => `${i + 2}. ${s?.address ?? JSON.stringify(s)}`).join(' · ');
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function resolveUser(row) {
  const user = row.app_users;
  if (user && !Array.isArray(user)) return user;
  if (Array.isArray(user) && user[0]) return user[0];
  return null;
}

function customerDisplayName(row) {
  const u = resolveUser(row);
  return u?.full_name?.trim() || 'Guest';
}

/** Driver row merged in `load()` from `driver_registrations`. */
function driverDisplayName(row) {
  const p = row?.driver_profile;
  const n = p && typeof p.full_name === 'string' ? p.full_name.trim() : '';
  if (n) return n;
  if (row?.assigned_driver_id) return 'Driver (profile unavailable)';
  return '';
}

function initials(name) {
  const n = String(name || '').trim();
  if (!n || n === 'Guest') return 'GU';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid') return 'admBadgeStatus admGreen';
  if (s === 'assigned') return 'admBadgeStatus admBlue';
  if (s === 'delivered') return 'admBadgeStatus admGreen';
  if (s === 'cancelled') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admOrange';
}

function serviceClass() {
  return 'admBadgeStatus admGreen';
}

export default function AdminDeliveryOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setOrders([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);

    let query = supabase
      .from('customer_delivery_orders')
      .select(
        `
        *,
        app_users (
          id,
          full_name,
          phone,
          email,
          created_at
        )
      `,
      )
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false });

    let { data, error: qErr } = await query;

    if (qErr && /relationship|schema cache/i.test(qErr.message || '')) {
      const fallback = await supabase
        .from('customer_delivery_orders')
        .select('*')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });
      data = fallback.data;
      qErr = fallback.error;
    }

    if (qErr) {
      setOrders([]);
      setError(qErr.message);
      setLoading(false);
      return;
    }

    const raw = Array.isArray(data) ? data : [];
    const driverIds = [...new Set(raw.map((r) => r.assigned_driver_id).filter(Boolean))];
    let driverMap = {};
    if (driverIds.length > 0) {
      const { data: drList, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate')
        .in('id', driverIds);
      if (!dErr && Array.isArray(drList)) {
        driverMap = Object.fromEntries(drList.map((d) => [d.id, d]));
      }
    }
    const enriched = raw.map((r) => ({
      ...r,
      driver_profile: r.assigned_driver_id ? driverMap[r.assigned_driver_id] ?? null : null,
    }));

    setOrders(enriched);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = selectedOrder?.id;
    if (!id) return;
    const fresh = orders.find((o) => o.id === id);
    if (fresh) setSelectedOrder(fresh);
  }, [orders, selectedOrder?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !deleteWorking) setPendingDelete(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDelete, deleteWorking]);

  const confirmDeleteOrder = async () => {
    if (!pendingDelete?.id || !isSupabaseConfigured || !supabase) {
      setDeleteErr(!supabase ? 'Database is not configured.' : 'No order selected.');
      return;
    }
    setDeleteWorking(true);
    setDeleteErr('');
    const { error } = await supabase.from('customer_delivery_orders').delete().eq('id', pendingDelete.id);
    setDeleteWorking(false);
    if (error) {
      setDeleteErr(error.message || 'Could not delete order. Check DELETE policy on customer_delivery_orders.');
      return;
    }
    setOrders((prev) => prev.filter((o) => o.id !== pendingDelete.id));
    if (selectedOrder?.id === pendingDelete.id) setSelectedOrder(null);
    setPendingDelete(null);
  };

  const stats = useMemo(() => {
    const total = orders.length;
    const placed = orders.filter((o) => String(o.status || '').toLowerCase() === 'placed').length;
    const paid = orders.filter((o) => {
      const s = String(o.status || '').toLowerCase();
      return s === 'paid' || s === 'assigned' || s === 'delivered';
    }).length;
    const guests = orders.filter((o) => !resolveUser(o)).length;
    const paidPct = total ? Math.round((paid / total) * 100) : 0;
    const guestPct = total ? Math.round((guests / total) * 100) : 0;
    return { total, placed, paid, guests, paidPct, guestPct };
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter((row) => {
      const ref = shortOrderRef(row.id).toLowerCase();
      const name = customerDisplayName(row).toLowerCase();
      const u = resolveUser(row);
      const email = (u?.email || '').toLowerCase();
      const phone = (u?.phone || '').toLowerCase();
      const pickup = (row.pickup_location || '').toLowerCase();
      const dropoff = (row.dropoff_location || '').toLowerCase();
      const driverName = driverDisplayName(row).toLowerCase();
      const matchQ =
        !q ||
        ref.includes(q) ||
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        pickup.includes(q) ||
        dropoff.includes(q) ||
        driverName.includes(q);

      const st = String(row.status || '').toLowerCase();
      const matchTab =
        activeTab === 'All' ||
        (activeTab === 'Placed' && st === 'placed') ||
        (activeTab === 'Paid' && (st === 'paid' || st === 'assigned' || st === 'delivered'));

      const matchPay =
        paymentFilter === 'All' ||
        (paymentFilter === 'Bank' && row.payment_method === 'ecocash') ||
        (paymentFilter === 'Card' && (row.payment_method === 'card' || row.payment_method === 'stripe')) ||
        (paymentFilter === 'Cash' && row.payment_method === 'cod');

      return matchQ && matchTab && matchPay;
    });
  }, [activeTab, orders, paymentFilter, search]);

  const sel = selectedOrder;
  const selUser = sel ? resolveUser(sel) : null;
  const selName = sel ? customerDisplayName(sel) : '';

  useSetAdminHeaderActions(
    <>
      <AdminHeaderOutlineBtn type="button">Export</AdminHeaderOutlineBtn>
      <AdminHeaderRefresh onClick={() => load()} disabled={loading} />
    </>,
    [loading, load],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <div className="admFilters">
          <input className="admInput admDateInput" readOnly defaultValue="Live data" title="Filtered list loads from database" />
        </div>
      </div>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Total delivery orders</h4>
          <p className="v">{loading ? '…' : stats.total}</p>
          <p className="s" style={{ color: '#0A58A6' }}>
            Excluding cancelled
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#ec9120' }}>
          <h4>Status: placed</h4>
          <p className="v" style={{ color: '#ec9120' }}>
            {loading ? '…' : stats.placed}
          </p>
          <p className="s" style={{ color: '#ec9120' }}>
            Awaiting payment / fulfilment
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Paid &amp; in progress</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : stats.paid}
          </p>
          <p className="s" style={{ color: '#0A58A6' }}>
            Paid, assigned, or delivered
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#9aa899' }}>
          <h4>Guest checkout</h4>
          <p className="v" style={{ color: '#5c665c' }}>
            {loading ? '…' : stats.guests}
          </p>
          <p className="s" style={{ color: '#7a847a' }}>
            {stats.guestPct}% without logged-in account
          </p>
        </article>
      </section>

      <section className="admTabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search order ID, customer, email, route..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="admFilters">
            <select className="admSelect" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <option>All</option>
              <option>Bank</option>
              <option>Card</option>
              <option>Cash</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admCard">
        {loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading orders…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem', margin: 0 }}>
            No orders match your filters. Place a delivery order from the app to see rows here.
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable admWideTable">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Service</th>
                  <th>Customer</th>
                  <th>Driver</th>
                  <th>Pickup</th>
                  <th>Dropoff</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Date &amp; Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const name = customerDisplayName(row);
                  const ini = initials(name);
                  return (
                    <tr key={row.id} className="admClickableRow" onClick={() => setSelectedOrder(row)}>
                      <td>
                        <button className="admLink" type="button">
                          {shortOrderRef(row.id)}
                        </button>
                      </td>
                      <td>
                        <span className={serviceClass()}>Delivery</span>
                      </td>
                      <td>
                        <div className="admInlineUser">
                          <span className="admMiniAvatar">{ini}</span>
                          {name}
                        </div>
                      </td>
                      <td>
                        {driverDisplayName(row) ? (
                          <span style={{ fontWeight: 600, color: '#1a3d1a' }}>{driverDisplayName(row)}</span>
                        ) : (
                          <span className="admUnassigned">Unassigned</span>
                        )}
                      </td>
                      <td className="admDim">{row.pickup_location ?? '—'}</td>
                      <td className="admDim">{row.dropoff_location ?? '—'}</td>
                      <td style={{ fontWeight: 700 }}>{formatGBP(row.total_amount)}</td>
                      <td>{paymentShort(row.payment_method)}</td>
                      <td className="admDim">{formatDt(row.created_at)}</td>
                      <td>
                        <span className={statusBadgeClass(row.status)}>{row.status ?? '—'}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="admActions">
                          <button
                            type="button"
                            aria-label="View details"
                            onClick={() => setSelectedOrder(row)}
                          >
                            👁
                          </button>
                          <button
                            type="button"
                            aria-label="Delete order"
                            style={{ color: '#d34444' }}
                            onClick={() => {
                              setPendingDelete(row);
                              setDeleteErr('');
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className={`admPanel${selectedOrder ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Order detail</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelectedOrder(null)} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="admPanelBody">
          {sel && (
            <>
              <section className="admPanelBlock">
                <div className="admSectionHeader" style={{ marginBottom: '0.2rem' }}>
                  <h3 style={{ margin: 0 }}>{shortOrderRef(sel.id)}</h3>
                  <span className={serviceClass()}>Delivery</span>
                </div>
                <span className={statusBadgeClass(sel.status)} style={{ fontSize: '0.78rem' }}>
                  {sel.status ?? '—'}
                </span>
                <p className="admDim" style={{ marginBottom: 0 }}>
                  {formatDt(sel.created_at)}
                </p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Timeline</h4>
                <div className="admTimeline">
                  <div className="admTimelineRow">
                    <span className="admTimelineDot done" />
                    <div>
                      <div style={{ fontWeight: 700 }}>Order placed</div>
                      <div className="admDim">{formatDt(sel.created_at)}</div>
                    </div>
                  </div>
                  <div className="admTimelineRow">
                    <span className={`admTimelineDot${sel.assigned_driver_id ? ' done' : ' muted'}`} />
                    <div>
                      <div style={{ fontWeight: 700 }}>Driver assigned</div>
                      <div className="admDim">
                        {driverDisplayName(sel)
                          ? `${driverDisplayName(sel)}${sel.assigned_at ? ` · ${formatDt(sel.assigned_at)}` : ''}`
                          : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="admTimelineRow">
                    <span className={`admTimelineDot${String(sel.status || '').toLowerCase() === 'delivered' ? ' done' : ' muted'}`} />
                    <div>
                      <div style={{ fontWeight: 700 }}>Delivered</div>
                      <div className="admDim">
                        {String(sel.status || '').toLowerCase() === 'delivered' && sel.completed_at
                          ? formatDt(sel.completed_at)
                          : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Customer</h4>
                <div className="admInlineUser">
                  <span className="admMiniAvatar">{initials(selName)}</span>
                  <strong>{selName}</strong>
                </div>
                <p className="admDim">{selUser?.phone ?? '—'}</p>
                <p className="admDim">{selUser?.email ?? '—'}</p>
                {selUser?.id ? (
                  <p className="admDim" style={{ wordBreak: 'break-all' }}>
                    User ID: {selUser.id}
                  </p>
                ) : (
                  <p className="admUnassigned">Guest checkout</p>
                )}
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Driver</h4>
                {driverDisplayName(sel) ? (
                  <>
                    <div className="admInlineUser" style={{ marginBottom: '0.35rem' }}>
                      <span className="admMiniAvatar">{initials(driverDisplayName(sel))}</span>
                      <strong>{sel.driver_profile?.full_name?.trim() || driverDisplayName(sel)}</strong>
                    </div>
                    {sel.driver_profile?.phone ? (
                      <p className="admDim" style={{ margin: '0.15rem 0' }}>
                        {[sel.driver_profile.phone_country_code, sel.driver_profile.phone].filter(Boolean).join(' ').trim()}
                      </p>
                    ) : null}
                    <p className="admDim" style={{ margin: '0.15rem 0' }}>
                      Vehicle:{' '}
                      {[sel.driver_profile?.vehicle_type, sel.driver_profile?.vehicle_make, sel.driver_profile?.vehicle_model]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    <p className="admDim" style={{ margin: '0.15rem 0' }}>
                      Plate: {sel.driver_profile?.vehicle_plate ?? '—'}
                    </p>
                    {sel.assigned_driver_id ? (
                      <p className="admDim" style={{ wordBreak: 'break-all', marginTop: '0.35rem' }}>
                        Driver ID: {sel.assigned_driver_id}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="admUnassigned">Unassigned</p>
                    <button className="admBtn" type="button" disabled style={{ opacity: 0.65 }}>
                      Assign driver (soon)
                    </button>
                  </>
                )}
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Route</h4>
                <div className="admMapMock">Route preview</div>
                <p style={{ margin: '0.4rem 0 0.2rem' }}>
                  <span className="admDotGreen" /> {sel.pickup_location ?? '—'}
                </p>
                <p className="admDashLine">- - - - - - - - -</p>
                <p style={{ margin: '0.2rem 0' }}>
                  <span className="admDotRed" /> {sel.dropoff_location ?? '—'}
                </p>
                <p className="admDim">Distance estimate: {sel.distance_estimate ?? '—'}</p>
                {extraStopsLabel(sel.extra_stops) ? (
                  <p className="admDim" style={{ marginTop: '0.35rem' }}>
                    Extra stops: {extraStopsLabel(sel.extra_stops)}
                  </p>
                ) : null}
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Package</h4>
                <p style={{ margin: '0.2rem 0' }}>
                  Size: {sel.package_size ?? '—'} · Weight: {sel.package_weight ?? '—'}
                </p>
                <p style={{ margin: '0.2rem 0' }}>Category: {sel.package_category ?? '—'}</p>
                <p className="admDim">Notes: {sel.package_notes ?? '—'}</p>
                <p className="admDim">Photo: {sel.package_photo_filename ?? '—'}</p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Payment</h4>
                <p style={{ margin: '0.2rem 0' }}>Method: {paymentLabel(sel.payment_method)}</p>
                <p className="admDim">
                  Base: {formatGBP(sel.base_fare_amount)} · Distance: {formatGBP(sel.distance_fee_amount)} · Service:{' '}
                  {formatGBP(sel.service_fee_amount)}
                </p>
                <p style={{ color: '#0A58A6', fontWeight: 800, marginBottom: '0.2rem' }}>
                  Total: {formatGBP(sel.total_amount)}
                </p>
                <span className={statusBadgeClass(sel.status)}>{sel.status ?? 'placed'}</span>
                <p className="admDim" style={{ marginTop: '0.45rem', wordBreak: 'break-all' }}>
                  Row UUID: {sel.id}
                </p>
                {sel.delivery_request_id ? (
                  <p className="admDim" style={{ wordBreak: 'break-all' }}>
                    Prior request: {sel.delivery_request_id}
                  </p>
                ) : null}
              </section>

              <section className="admPanelActions">
                <button className="admOutlineBtn" type="button">
                  Reassign driver
                </button>
                <button
                  className="admDangerBtn"
                  type="button"
                  onClick={() => {
                    setPendingDelete(sel);
                    setDeleteErr('');
                  }}
                >
                  Delete order
                </button>
                <button className="admInfoBtn" type="button">
                  Send notification
                </button>
              </section>
            </>
          )}
        </div>
      </aside>

      {pendingDelete ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-delete-title">
          <button
            type="button"
            className="admModalBackdrop"
            aria-label="Close"
            onClick={() => !deleteWorking && setPendingDelete(null)}
          />
          <div className="admModalCard">
            <div className="admModalCardInner">
              <div className="admModalIconWrap" aria-hidden>
                🗑
              </div>
              <h2 id="adm-delete-title" className="admModalTitle">
                Delete this order?
              </h2>
              <p className="admModalText">
                This permanently removes the delivery order from your database. You can’t undo this action.
                <span className="admModalOrderTag">{shortOrderRef(pendingDelete.id)}</span>
              </p>
              {deleteErr ? (
                <p className="admModalErr" role="alert">
                  {deleteErr}
                </p>
              ) : null}
              <div className="admModalActions">
                <button
                  type="button"
                  className="admModalBtnGhost"
                  disabled={deleteWorking}
                  onClick={() => setPendingDelete(null)}
                >
                  Keep order
                </button>
                <button
                  type="button"
                  className="admModalBtnDanger"
                  disabled={deleteWorking}
                  onClick={() => confirmDeleteOrder()}
                >
                  {deleteWorking ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
