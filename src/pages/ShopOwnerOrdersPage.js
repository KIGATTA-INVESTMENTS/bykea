import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import { notifyDriversOfNewOffer } from '../lib/driverOfferPushNotify';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { shopOwnerOrderStatusLabel } from '../lib/shopOrderStatus';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerOrdersPremium.css';

const TABS = ['All', 'New order', 'Preparing', 'Ready for pickup', 'Picked up', 'In transit', 'Delivered', 'Cancelled'];

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

function bdg(s) {
  const x = String(s || '').toLowerCase();
  if (x === 'delivered') return 'soo-badge soo-badge--delivered';
  if (x === 'in transit') return 'soo-badge soo-badge--transit';
  if (x === 'picked up') return 'soo-badge soo-badge--picked';
  if (x === 'ready for pickup' || x === 'ready for delivery') return 'soo-badge soo-badge--ready';
  if (x === 'preparing' || x === 'processing') return 'soo-badge soo-badge--processing';
  if (x === 'cancelled') return 'soo-badge soo-badge--cancelled';
  if (x === 'new order' || x === 'pending' || x === 'placed') return 'soo-badge soo-badge--pending';
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

function mapGroupedToRow({ order, lines }, session) {
  const amt = lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
  const itemsStr = lines.map((l) => `${l.product_name} ×${l.quantity}`).join(', ');
  const statusRaw = String(order.status || 'placed')
    .toLowerCase()
    .trim();
  const st = shopOwnerOrderStatusLabel(statusRaw);
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
    statusRaw,
    phone: order.customer_phone,
    email: order.customer_email || '',
    notes: order.customer_notes || '',
    myLines: lines,
  };
}

export default function ShopOwnerOrdersPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');
  const [actionErr, setActionErr] = useState('');

  const openOrder = (orderDbId) => {
    navigate(`/shop-owner/orders/${encodeURIComponent(orderDbId)}`);
  };

  const confirmOrder = async (e, orderDbId) => {
    e.stopPropagation();
    e.preventDefault();
    if (!supabase || !orderDbId) return;
    setActionErr('');
    setActionBusyId(orderDbId);
    try {
      const sid = getShopOwnerSession()?.id;
      const { data: all } = await supabase
        .from('shop_customer_order_lines')
        .select('shop_owner_id')
        .eq('order_id', orderDbId);
      if (!sid || !all?.length || !all.every((l) => l.shop_owner_id === sid)) {
        setActionErr('This order includes other shops. Open the order for details, or ask an admin.');
        return;
      }
      const { error } = await supabase
        .from('shop_customer_orders')
        .update({ status: 'processing' })
        .eq('id', orderDbId);
      if (error) {
        setActionErr(error.message);
        return;
      }
      await load();
      navigate(`/shop-owner/orders/${encodeURIComponent(orderDbId)}`);
    } catch {
      setActionErr('Could not confirm order. Try again.');
    } finally {
      setActionBusyId('');
    }
  };

  const markReady = async (e, orderDbId) => {
    e.stopPropagation();
    e.preventDefault();
    if (!supabase || !orderDbId) return;
    setActionErr('');
    setActionBusyId(orderDbId);
    try {
      const sid = getShopOwnerSession()?.id;
      const { data: all } = await supabase
        .from('shop_customer_order_lines')
        .select('shop_owner_id')
        .eq('order_id', orderDbId);
      if (!sid || !all?.length || !all.every((l) => l.shop_owner_id === sid)) {
        setActionErr('This order includes other shops. Open the order for details, or ask an admin.');
        return;
      }
      const { error } = await supabase
        .from('shop_customer_orders')
        .update({ status: 'ready for delivery' })
        .eq('id', orderDbId);
      if (error) {
        setActionErr(error.message);
        return;
      }
      notifyDriversOfNewOffer('shop_customer_orders', orderDbId);
      await load();
    } catch {
      setActionErr('Could not update order. Try again.');
    } finally {
      setActionBusyId('');
    }
  };

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

      {actionErr ? (
        <div className="soo-error" role="alert">
          <p>{actionErr}</p>
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
                        <button type="button" className="soo-order-link" onClick={() => openOrder(r.orderDbId)}>
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
                          {r.statusRaw === 'placed' ? (
                            <button
                              type="button"
                              className="soo-cta-btn"
                              disabled={actionBusyId === r.orderDbId}
                              onClick={(e) => confirmOrder(e, r.orderDbId)}
                            >
                              {actionBusyId === r.orderDbId ? 'Confirming…' : 'Confirm'}
                            </button>
                          ) : null}
                          {r.statusRaw === 'processing' ? (
                            <button
                              type="button"
                              className="soo-cta-btn soo-cta-btn--ready"
                              disabled={actionBusyId === r.orderDbId}
                              onClick={(e) => markReady(e, r.orderDbId)}
                            >
                              {actionBusyId === r.orderDbId ? 'Updating…' : 'Mark ready'}
                            </button>
                          ) : null}
                          <button type="button" className="soo-text-btn" onClick={() => openOrder(r.orderDbId)}>
                            View
                          </button>
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
    </div>
  );
}
