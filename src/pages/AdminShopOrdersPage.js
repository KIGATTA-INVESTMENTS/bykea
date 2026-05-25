import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { shopOrderGrandTotal } from '../lib/shopDeliverySettings';
import { shopOrderStatusLabel } from '../lib/shopOrderStatus';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

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

function IconView() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 7h16M6.5 7V18a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V7M9.5 10.5V16M12.5 10.5V16M8.5 4.5h7l.5 1.5H8Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function AdminShopOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewOrder, setViewOrder] = useState(null);
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
    const { data: rows, error: oErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .order('placed_at', { ascending: false });

    if (oErr) {
      setOrders([]);
      setError(
        oErr.message?.includes('shop_customer_orders')
          ? `${oErr.message} — Run shop_customer_orders.sql in your SQL editor if the table is missing.`
          : oErr.message,
      );
      setLoading(false);
      return;
    }

    const list = Array.isArray(rows) ? rows : [];
    const ids = list.map((o) => o.id).filter(Boolean);
    let linesByOrder = {};
    if (ids.length) {
      const { data: lines, error: lErr } = await supabase.from('shop_customer_order_lines').select('*').in('order_id', ids);
      if (lErr) {
        setOrders([]);
        setError(lErr.message);
        setLoading(false);
        return;
      }
      for (const l of lines || []) {
        if (!linesByOrder[l.order_id]) linesByOrder[l.order_id] = [];
        linesByOrder[l.order_id].push(l);
      }
    }

    setOrders(list.map((o) => ({ ...o, lines: linesByOrder[o.id] || [] })));
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

  useEffect(() => {
    if (!viewOrder && !pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (deleteWorking) return;
      setViewOrder(null);
      setPendingDelete(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewOrder, pendingDelete, deleteWorking]);

  const confirmDelete = async () => {
    if (!pendingDelete?.id || !isSupabaseConfigured || !supabase) {
      setDeleteErr(!supabase ? 'Database is not configured.' : 'No order selected.');
      return;
    }
    setDeleteWorking(true);
    setDeleteErr('');
    const { error } = await supabase.from('shop_customer_orders').delete().eq('id', pendingDelete.id);
    setDeleteWorking(false);
    if (error) {
      setDeleteErr(error.message || 'Could not delete. Check DELETE policy on shop_customer_orders.');
      return;
    }
    setOrders((prev) => prev.filter((o) => o.id !== pendingDelete.id));
    if (viewOrder?.id === pendingDelete.id) setViewOrder(null);
    setPendingDelete(null);
  };

  const stats = useMemo(() => {
    const total = orders.length;
    const revenue = orders.reduce((s, o) => s + shopOrderGrandTotal(o), 0);
    const items = orders.reduce((s, o) => s + (o.lines || []).reduce((t, l) => t + (Number(l.quantity) || 0), 0), 0);
    return { total, revenue, items };
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter((o) => {
      if (!q) return true;
      const blob = [
        o.order_number,
        o.customer_full_name,
        o.customer_phone,
        o.customer_email,
        o.customer_address,
        ...(o.lines || []).map((l) => [l.product_name, l.shop_name].filter(Boolean).join(' ')),
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [orders, search]);

  const v = viewOrder;

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <div className="admFilters">
          <input className="admInput admDateInput" readOnly defaultValue="Live data" title="From shop checkout" />
        </div>
      </div>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#F18631' }}>
          <h4>Shop orders</h4>
          <p className="v">{loading ? '…' : stats.total}</p>
          <p className="s" style={{ color: '#A85612' }}>
            From /shops checkout
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Product units sold</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : stats.items}
          </p>
          <p className="s" style={{ color: '#0A58A6' }}>
            Sum of line quantities
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Subtotal (all orders)</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : formatGBP(stats.revenue)}
          </p>
          <p className="s" style={{ color: '#0A58A6' }}>
            USD
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#9aa899' }}>
          <h4>Latest</h4>
          <p className="v" style={{ color: '#5c665c', fontSize: '0.95rem' }}>
            {loading ? '…' : orders[0]?.order_number || '—'}
          </p>
          <p className="s" style={{ color: '#7a847a' }}>
            Most recent order ref
          </p>
        </article>
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search order #, customer, phone, product, shop…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="admCard">
        {loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading shop orders…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem', margin: 0 }}>
            {orders.length === 0 ? 'No shop orders yet. Customer orders appear here after checkout from /shops.' : 'No orders match your search.'}
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Lines</th>
                  <th>Subtotal</th>
                  <th>Delivery</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Placed</th>
                  <th style={{ width: '5.5rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const lineCount = (o.lines || []).length;
                  const qtySum = (o.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
                  return (
                    <tr key={o.id}>
                        <td>
                          <code style={{ fontWeight: 700 }}>{o.order_number}</code>
                        </td>
                        <td>
                          <strong>{o.customer_full_name}</strong>
                          <div className="admDim" style={{ fontSize: '0.75rem', maxWidth: '14rem', marginTop: 2 }}>
                            {o.customer_address}
                          </div>
                        </td>
                        <td>
                          <div>{o.customer_phone}</div>
                          {o.customer_email ? <div className="admDim" style={{ fontSize: '0.78rem' }}>{o.customer_email}</div> : null}
                        </td>
                        <td>
                          {lineCount} line{lineCount === 1 ? '' : 's'} · {qtySum} unit{qtySum === 1 ? '' : 's'}
                        </td>
                        <td>{formatGBP(Number(o.subtotal) || 0)}</td>
                        <td>{formatGBP(Number(o.delivery_fee) || 0)}</td>
                        <td style={{ fontWeight: 800 }}>{formatGBP(shopOrderGrandTotal(o))}</td>
                        <td style={{ fontWeight: 700, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                          {shopOrderStatusLabel(o.status)}
                        </td>
                        <td className="admDim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                          {formatDt(o.placed_at)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <button
                              type="button"
                              className="admShopOrdIcon admShopOrdIcon--view"
                              aria-label={`View order ${o.order_number}`}
                              onClick={() => setViewOrder(o)}
                            >
                              <IconView />
                            </button>
                            <button
                              type="button"
                              className="admShopOrdIcon admShopOrdIcon--del"
                              aria-label={`Delete order ${o.order_number}`}
                              onClick={() => {
                                setPendingDelete({
                                  id: o.id,
                                  order_number: o.order_number,
                                  customer_full_name: o.customer_full_name,
                                });
                                setDeleteErr('');
                              }}
                            >
                              <IconTrash />
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

      {v ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-shop-view-title">
          <button type="button" className="admModalBackdrop" aria-label="Close" onClick={() => setViewOrder(null)} />
          <div className="admModalCard" style={{ maxWidth: '28rem', width: '100%' }}>
            <div className="admModalCardInner" style={{ textAlign: 'left' }}>
              <h2 id="adm-shop-view-title" className="admModalTitle" style={{ textAlign: 'left' }}>
                Order {v.order_number}
              </h2>
              <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.82rem' }}>
                {formatDt(v.placed_at)} · {shopOrderStatusLabel(v.status)} · Total {formatGBP(shopOrderGrandTotal(v))}
              </p>
              <section style={{ marginBottom: '0.75rem' }}>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Customer</p>
                <p style={{ margin: 0, fontWeight: 700 }}>{v.customer_full_name}</p>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.88rem' }}>{v.customer_phone}</p>
                {v.customer_email ? <p style={{ margin: '0.15rem 0 0', fontSize: '0.88rem' }}>{v.customer_email}</p> : null}
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.84rem', lineHeight: 1.45 }}>{v.customer_address}</p>
                {v.customer_notes ? (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.84rem' }}>
                    <strong>Notes:</strong> {v.customer_notes}
                  </p>
                ) : null}
              </section>
              <section>
                <p style={{ margin: '0 0 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Products</p>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.86rem' }}>
                  {(v.lines || []).map((l) => (
                    <li key={l.id} style={{ marginBottom: '0.35rem' }}>
                      <strong>{l.product_name}</strong>
                      <span className="admDim"> · {l.shop_name || 'Shop'}</span>
                      <br />
                      <span className="admDim">
                        ×{l.quantity} @ {formatGBP(Number(l.unit_price) || 0)}
                      </span>{' '}
                      → <strong>{formatGBP(Number(l.line_total) || 0)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="admModalActions" style={{ marginTop: '1rem' }}>
                <button type="button" className="admModalBtnGhost" onClick={() => setViewOrder(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="admModalBtnDanger"
                  onClick={() => {
                    setViewOrder(null);
                    setPendingDelete({
                      id: v.id,
                      order_number: v.order_number,
                      customer_full_name: v.customer_full_name,
                    });
                    setDeleteErr('');
                  }}
                >
                  Delete this order
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-shop-del-title">
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
              <h2 id="adm-shop-del-title" className="admModalTitle">
                Delete this shop order?
              </h2>
              <p className="admModalText">
                This removes <span className="admModalOrderTag">{pendingDelete.order_number}</span> for{' '}
                <strong>{pendingDelete.customer_full_name}</strong> and all line items. You cannot undo this.
              </p>
              {deleteErr ? (
                <p className="admModalErr" role="alert">
                  {deleteErr}
                </p>
              ) : null}
              <div className="admModalActions">
                <button type="button" className="admModalBtnGhost" disabled={deleteWorking} onClick={() => setPendingDelete(null)}>
                  Cancel
                </button>
                <button type="button" className="admModalBtnDanger" disabled={deleteWorking} onClick={confirmDelete}>
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
