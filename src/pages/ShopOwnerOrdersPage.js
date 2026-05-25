import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatGBP } from '../lib/currency';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerOrdersPremium.css';

const STEPS = ['Order placed', 'Processing', 'Ready for delivery', 'Picked up', 'In transit', 'Delivered'];

const TABS = ['All', 'Pending', 'Processing', 'Ready for delivery', 'Picked up', 'In transit', 'Delivered', 'Cancelled'];

/** DB values for fulfillment (shop owner–controlled). */
const FULFILLMENT_STATUS_OPTIONS = [
  { db: 'processing', label: 'Processing' },
  { db: 'ready for delivery', label: 'Ready for delivery' },
  { db: 'picked up', label: 'Picked up' },
  { db: 'in transit', label: 'In transit' },
  { db: 'delivered', label: 'Delivered' },
];

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

/** Map DB status to shop-owner UI tab labels */
function displayStatus(raw) {
  const s = String(raw || 'placed').toLowerCase().replace(/_/g, ' ');
  if (s === 'placed') return 'Pending';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'delivered') return 'Delivered';
  if (s === 'processing') return 'Processing';
  if (s === 'ready for delivery') return 'Ready for delivery';
  if (s === 'in transit') return 'In transit';
  if (s === 'picked up') return 'Picked up';
  return raw ? String(raw).replace(/^\w/, (c) => c.toUpperCase()) : 'Pending';
}

function bdg(s) {
  const x = String(s || '').toLowerCase();
  if (x === 'delivered') return 'soo-badge soo-badge--delivered';
  if (x === 'in transit') return 'soo-badge soo-badge--transit';
  if (x === 'picked up') return 'soo-badge soo-badge--picked';
  if (x === 'ready for delivery') return 'soo-badge soo-badge--ready';
  if (x === 'processing') return 'soo-badge soo-badge--processing';
  if (x === 'cancelled') return 'soo-badge soo-badge--cancelled';
  if (x === 'pending' || x === 'placed') return 'soo-badge soo-badge--pending';
  return 'soo-badge soo-badge--pending';
}

function IcRefresh() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.1-5.3M20 4v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IcSearch() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden className="soo-search-icon">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IcEmptyBox() {
  return (
    <svg viewBox="0 0 80 80" width="80" height="80" fill="none" aria-hidden className="soo-empty-icon">
      <rect x="12" y="22" width="56" height="44" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 34h56" stroke="currentColor" strokeWidth="2" />
      <path d="M28 22V14h24v8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function stepIndex(status) {
  const x = String(status || '').toLowerCase();
  if (x === 'pending' || x === 'placed') return 0;
  if (x === 'cancelled') return 0;
  if (x === 'processing') return 1;
  if (x === 'ready for delivery') return 2;
  if (x === 'picked up') return 3;
  if (x === 'in transit') return 4;
  if (x === 'delivered') return 5;
  return 0;
}

function mapGroupedToRow({ order, lines }, session) {
  const amt = lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
  const itemsStr = lines.map((l) => `${l.product_name} ×${l.quantity}`).join(', ');
  const st = displayStatus(order.status);
  return {
    orderDbId: order.id,
    id: order.order_number,
    customer: order.customer_full_name,
    items: itemsStr,
    pickup: session?.business_name ? `${session.business_name} (your shop)` : 'Your shop',
    drop: order.customer_address,
    amount: formatGBP(amt),
    amountNum: amt,
    date: formatDt(order.placed_at),
    status: st,
    statusRaw: String(order.status || 'placed')
      .toLowerCase()
      .trim(),
    phone: order.customer_phone,
    email: order.customer_email || '',
    notes: order.customer_notes || '',
    myLines: lines,
  };
}

function IcView() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M2 12s4-5.2 10-5.2S22 12 22 12s-4 5.2-10 5.2S2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.1"
        fill="none"
      />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}
function IcTr() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path d="M3 7h18M5 3l-2 4M19 3l2 4M3 7v12h18V7" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}
function IcX() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M5 5.5L18.2 19M5 18.5L18.2 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ShopOwnerOrdersPage() {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    const s = getShopOwnerSession();
    if (!s?.id) {
      setRows([]);
      setLoadError('Sign in as a shop owner to see orders for your products.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setLoadError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    const { data: lineRows, error: lErr } = await supabase
      .from('shop_customer_order_lines')
      .select('*')
      .eq('shop_owner_id', s.id);

    if (lErr) {
      setRows([]);
      setLoadError(
        lErr.message?.includes('shop_customer_order_lines')
          ? `${lErr.message} — Run supabase/shop_customer_orders.sql.`
          : lErr.message,
      );
      setLoading(false);
      return;
    }

    const lines = Array.isArray(lineRows) ? lineRows : [];
    const orderIds = [...new Set(lines.map((l) => l.order_id).filter(Boolean))];
    let orderMap = {};
    if (orderIds.length) {
      const { data: ordRows, error: oErr } = await supabase.from('shop_customer_orders').select('*').in('id', orderIds);
      if (oErr) {
        setRows([]);
        setLoadError(oErr.message);
        setLoading(false);
        return;
      }
      for (const o of ordRows || []) orderMap[o.id] = o;
    }

    const grouped = {};
    for (const l of lines) {
      const ord = orderMap[l.order_id];
      if (!ord) continue;
      if (!grouped[l.order_id]) grouped[l.order_id] = { order: ord, lines: [] };
      grouped[l.order_id].lines.push(l);
    }

    const list = Object.values(grouped).sort((a, b) => new Date(b.order.placed_at) - new Date(a.order.placed_at));
    setRows(list.map((g) => mapGroupedToRow(g, s)));
    setLoadError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setCancelErr('');
    setStatusErr('');
  }, [sel]);

  const filtered = useMemo(() => {
    let list = rows;
    if (tab !== 'All') {
      list = list.filter((o) => o.status === tab);
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter(
        (o) =>
          String(o.id).toLowerCase().includes(t) ||
          o.customer.toLowerCase().includes(t) ||
          o.items.toLowerCase().includes(t) ||
          (o.email && o.email.toLowerCase().includes(t)) ||
          o.drop.toLowerCase().includes(t),
      );
    }
    return list;
  }, [tab, q, rows]);

  const o = useMemo(() => rows.find((x) => x.orderDbId === sel) || null, [rows, sel]);
  const si = o ? stepIndex(o.status) : 0;

  const soleSellerForOrder = async (orderId) => {
    if (!supabase) return false;
    const sid = getShopOwnerSession()?.id;
    if (!sid) return false;
    const { data: all } = await supabase.from('shop_customer_order_lines').select('shop_owner_id').eq('order_id', orderId);
    if (!all?.length) return false;
    return all.every((l) => l.shop_owner_id === sid);
  };

  const updateFulfillmentStatus = async (nextDb) => {
    const sid = getShopOwnerSession()?.id;
    if (!o || !sid || !supabase || !nextDb) return;
    const cur = o.statusRaw;
    if (cur === nextDb) return;
    setStatusErr('');
    setStatusBusy(true);
    try {
      const ok = await soleSellerForOrder(o.orderDbId);
      if (!ok) {
        setStatusErr('This order includes other shops. Only an admin can change status for the whole order.');
        setStatusBusy(false);
        return;
      }
      const { error } = await supabase.from('shop_customer_orders').update({ status: nextDb }).eq('id', o.orderDbId);
      if (error) {
        setStatusErr(error.message);
        setStatusBusy(false);
        return;
      }
      await load();
    } catch {
      setStatusErr('Could not update status. Try again.');
    } finally {
      setStatusBusy(false);
    }
  };

  const cancelOrder = async () => {
    const sid = getShopOwnerSession()?.id;
    if (!o || !sid || !supabase) return;
    setCancelErr('');
    setCancelBusy(true);
    try {
      const ok = await soleSellerForOrder(o.orderDbId);
      if (!ok) {
        setCancelErr('This order includes other shops. Only an admin can cancel the whole order.');
        setCancelBusy(false);
        return;
      }
      const { error } = await supabase.from('shop_customer_orders').update({ status: 'cancelled' }).eq('id', o.orderDbId);
      if (error) {
        setCancelErr(error.message);
        setCancelBusy(false);
        return;
      }
      await load();
      setSel(null);
    } catch {
      setCancelErr('Could not cancel. Try again.');
    } finally {
      setCancelBusy(false);
    }
  };

  const showEmpty = !loading && filtered.length === 0;
  const emptyNoOrders = rows.length === 0;

  return (
    <div className="soo-page">
      <div className="soo-head">
        <h1>My Orders</h1>
        <button type="button" className="soo-refresh" aria-label="Refresh" onClick={() => load()} disabled={loading}>
          <IcRefresh />
          Refresh
        </button>
      </div>

      {loadError ? (
        <div className="soo-error" role="alert">
          <p>{loadError}</p>
        </div>
      ) : null}

      <div className="soo-tabs" role="tablist" aria-label="Filter orders">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className={tab === t ? 'soo-tab soo-tab--on' : 'soo-tab'}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="soo-search-wrap">
        <IcSearch />
        <input
          className="soo-search"
          placeholder="Search by order ID, customer, items..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search orders"
        />
      </div>

      <div className={`soo-table-card${filtered.length > 0 ? ' soo-table-card--has-rows' : ''}`}>
        {showEmpty ? (
          <div className={`soo-empty${emptyNoOrders ? '' : ' soo-empty--filter'}`} role="status">
            <IcEmptyBox />
            <h2>{emptyNoOrders ? 'No orders yet' : 'No matching orders'}</h2>
            <p>
              {emptyNoOrders
                ? 'When customers buy your products from your shop, orders will appear here.'
                : 'Try a different filter or search term.'}
            </p>
          </div>
        ) : (
          <div className="soo-table-scroll">
            <table className="soo-table" aria-label="All orders">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Pickup</th>
                  <th>Delivery</th>
                  <th>Your Total</th>
                  <th>Date &amp; Time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="soo-table-loading">
                      Loading orders…
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.orderDbId}>
                      <td>
                        <button type="button" className="soo-order-link" onClick={() => setSel(r.orderDbId)}>
                          {r.id}
                        </button>
                      </td>
                      <td>{r.customer}</td>
                      <td className="soo-items-cell">{r.items}</td>
                      <td>{r.pickup}</td>
                      <td>{r.drop}</td>
                      <td>{r.amount}</td>
                      <td style={{ fontSize: '0.75rem' }}>{r.date}</td>
                      <td>
                        <span className={bdg(r.status)}>{r.status}</span>
                      </td>
                      <td>
                        <div className="soo-actions">
                          <button type="button" className="soo-icon-btn" aria-label="View" onClick={() => setSel(r.orderDbId)}>
                            <IcView />
                          </button>
                          <button type="button" className="soo-icon-btn" aria-label="View details" onClick={() => setSel(r.orderDbId)}>
                            <IcTr />
                          </button>
                          {r.status !== 'Cancelled' && r.status !== 'Delivered' && (
                            <button
                              type="button"
                              className="soo-icon-btn soo-icon-btn--danger"
                              aria-label="Cancel order"
                              onClick={() => setSel(r.orderDbId)}
                            >
                              <IcX />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="soo-count" aria-live="polite">
        {filtered.length} order{filtered.length === 1 ? '' : 's'} shown
      </p>

      <div className={o ? 'sopPan sopPan--on' : 'sopPan'} role="dialog" aria-modal="true" aria-label="Order details" style={{ zIndex: 300 }}>
        {o && (
          <>
            <div className="sopPanH" style={{ alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '0.9rem' }}>{o.id}</h2>
                <p style={{ margin: 0, fontSize: '0.72rem', color: '#6b6b6b' }}>{o.date}</p>
              </div>
              <button type="button" className="sopI2" onClick={() => setSel(null)} style={{ lineHeight: 1 }} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="sopPanB">
              <div className="sopPanC">
                <h3>Customer</h3>
                <strong>{o.customer}</strong>
                <div style={{ fontSize: '0.72rem', color: '#555', marginTop: 4 }}>{o.phone}</div>
                {o.email ? <div style={{ fontSize: '0.72rem', color: '#555', marginTop: 2 }}>{o.email}</div> : null}
              </div>
              <div className="sopPanC">
                <h3>Items ordered (your shop)</h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem' }}>
                  {o.myLines.map((l) => (
                    <li key={l.id}>
                      {l.product_name} ×{l.quantity} — {formatGBP(Number(l.line_total) || 0)}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#555' }}>Your portion of this checkout (other shops may appear on the same customer order).</div>
              </div>
              <div className="sopPanC">
                <h3>Delivery address</h3>
                {o.drop}
                {o.notes ? (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>
                    <strong>Customer notes:</strong> {o.notes}
                  </p>
                ) : null}
              </div>
              <div>
                <h3 style={{ margin: '0.2rem 0' }}>Status</h3>
                <div className="sopStep">
                  {STEPS.map((s, i) => {
                    const st = o.status.toLowerCase();
                    if (st === 'cancelled') {
                      return (
                        <div key={s} className="sopStL">
                          <span className="sopStPend">○ {s}</span>
                        </div>
                      );
                    }
                    if (st === 'delivered') {
                      return (
                        <div key={s} className="sopStL" style={i > 0 ? { borderLeft: '2px solid #e0e0e0', paddingLeft: 8, marginLeft: 4 } : {}}>
                          <span className="sopStDone">✓ {s}</span>
                        </div>
                      );
                    }
                    const done = i < si;
                    return (
                      <div key={s} className="sopStL" style={i > 0 ? { borderLeft: '2px solid #e0e0e0', paddingLeft: 8, marginLeft: 4 } : {}}>
                        <span className={done || i === si ? 'sopStDone' : 'sopStPend'}>
                          {done ? '✓' : '○'} {s}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {o.status.toLowerCase() === 'cancelled' && <p style={{ color: '#c62828', fontSize: '0.78rem' }}>This order was cancelled.</p>}
              </div>

              {!['cancelled', 'delivered'].includes(o.statusRaw) ? (
                <div className="sopPanC sopPanC--statusPick">
                  <h3>Change status</h3>
                  <p style={{ margin: '0 0 0.45rem', fontSize: '0.72rem', color: '#666', lineHeight: 1.35 }}>
                    Select the current stage for this order. Customers see updates on their order history.
                  </p>
                  <fieldset className="sopStatPick" disabled={statusBusy}>
                    <legend className="sopStatPick__leg">Fulfillment</legend>
                    {FULFILLMENT_STATUS_OPTIONS.map(({ db, label }) => (
                      <label key={db} className="sopStatPick__row">
                        <input
                          type="radio"
                          name={`fulfill-${o.orderDbId}`}
                          checked={o.statusRaw === db}
                          onChange={() => updateFulfillmentStatus(db)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                  {statusBusy ? <p className="sopStatPick__hint">Updating…</p> : null}
                  {statusErr ? (
                    <p role="alert" style={{ color: '#c62828', fontSize: '0.72rem', margin: '0.35rem 0 0' }}>
                      {statusErr}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="sopPanC">
                <h3>Payment</h3>
                <div>
                  Total for your items: <strong style={{ color: '#0A58A6' }}>{o.amount}</strong>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#666', marginTop: 4 }}>Demo: payment on delivery / as agreed with customer.</div>
              </div>
              {cancelErr ? (
                <p role="alert" style={{ color: '#c62828', fontSize: '0.78rem', margin: 0 }}>
                  {cancelErr}
                </p>
              ) : null}
              {o.status.toLowerCase() !== 'cancelled' && o.status.toLowerCase() !== 'delivered' && (
                <button type="button" className="sopBtn3" disabled={cancelBusy} onClick={cancelOrder}>
                  {cancelBusy ? 'Cancelling…' : 'Cancel order'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {o && (
        <div
          className="sopOvl sopOvl--on"
          onClick={() => {
            setSel(null);
            setCancelErr('');
          }}
          role="presentation"
          style={{ zIndex: 250 }}
        />
      )}
    </div>
  );
}
