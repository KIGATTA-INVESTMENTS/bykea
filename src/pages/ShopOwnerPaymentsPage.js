import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatGBP } from '../lib/currency';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerPaymentsPremium.css';

const TX_FILT = ['All', 'Sales', 'Payouts', 'Refunds'];

function txTypeClass(t) {
  if (t === 'Sale') return 'sopay-tx-type sopay-tx-type--sale';
  if (t === 'Payout') return 'sopay-tx-type sopay-tx-type--payout';
  return 'sopay-tx-type sopay-tx-type--refund';
}

function txStatusClass(s) {
  if (s === 'Completed') return 'sopay-tx-status sopay-tx-status--ok';
  if (s === 'Pending') return 'sopay-tx-status sopay-tx-status--pd';
  return 'sopay-tx-status sopay-tx-status--fl';
}

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function txStatusFromOrder(status) {
  const s = String(status || '').toLowerCase().replace(/_/g, ' ');
  if (s === 'cancelled') return 'Pending';
  if (s === 'delivered') return 'Completed';
  if (s === 'processing' || s === 'in transit' || s === 'placed' || s === 'picked up' || s === 'ready for delivery') return 'Pending';
  return 'Pending';
}

function payoutStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid') return 'Completed';
  if (s === 'approved' || s === 'pending') return 'Pending';
  return 'Failed';
}

function IcCalendar() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden className="sopay-date-icon">
      <rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3v3M16 3v3M4 10h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcTxEmpty() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden style={{ color: '#d1d5db' }}>
      <rect x="8" y="14" width="48" height="36" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M8 24h48M20 14V10h24v4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M22 32h8M22 38h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IcInvoiceEmpty() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden style={{ color: '#d1d5db' }}>
      <path
        d="M14 8h24l10 10v34a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M38 8v10h10M22 28h20M22 36h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IcPdf() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
      <path
        d="M6 2h8l4 4v16a.8.8 0 0 1-1.1.1H6.2A.8.8 0 0 1 5.5 21.5V2.1A.8.8 0 0 1 6.2 2Z"
        strokeLinejoin="round"
      />
      <path d="M14 2.2V6h2.1" />
    </svg>
  );
}

export default function ShopOwnerPaymentsPage() {
  const [f, setF] = useState('All');
  const [rows, setRows] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const session = getShopOwnerSession();
  const monthStart = startOfMonth();
  const monthLabel = useMemo(
    () =>
      `${monthStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`,
    [monthStart],
  );

  const load = useCallback(async () => {
    setLoadError('');
    if (!session?.id) {
      setRows([]);
      setWithdrawals([]);
      setLoadError('Sign in as shop owner to view payments.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setWithdrawals([]);
      setLoadError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: lineRows, error: lineErr } = await supabase
      .from('shop_customer_order_lines')
      .select('*')
      .eq('shop_owner_id', session.id);
    if (lineErr) {
      setLoadError(lineErr.message);
      setLoading(false);
      return;
    }

    const lines = Array.isArray(lineRows) ? lineRows : [];
    const orderIds = [...new Set(lines.map((l) => l.order_id).filter(Boolean))];
    let orderMap = {};
    if (orderIds.length) {
      const { data: orders, error: orderErr } = await supabase
        .from('shop_customer_orders')
        .select('*')
        .in('id', orderIds);
      if (orderErr) {
        setLoadError(orderErr.message);
        setLoading(false);
        return;
      }
      orderMap = Object.fromEntries((orders || []).map((o) => [o.id, o]));
    }

    const grouped = {};
    lines.forEach((line) => {
      const ord = orderMap[line.order_id];
      if (!ord) return;
      if (!grouped[line.order_id]) grouped[line.order_id] = { order: ord, amount: 0 };
      grouped[line.order_id].amount += Number(line.line_total) || 0;
    });

    const salesRows = Object.values(grouped).map((g) => ({
      id: `TX-${String(g.order.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      date: g.order.placed_at,
      customer: g.order.customer_full_name || 'Customer',
      order: g.order.order_number || '—',
      amount: Math.round(g.amount * 100) / 100,
      type: g.order.status === 'cancelled' ? 'Refund' : 'Sale',
      st: txStatusFromOrder(g.order.status),
    }));

    const { data: wdRows, error: wdErr } = await supabase
      .from('shop_owner_withdrawal_requests')
      .select('*')
      .eq('shop_owner_id', session.id)
      .order('requested_at', { ascending: false });
    if (wdErr) {
      setLoadError(
        wdErr.message?.includes('shop_owner_withdrawal_requests')
          ? `${wdErr.message} — Run supabase/shop_owner_withdrawal_requests.sql.`
          : wdErr.message,
      );
      setLoading(false);
      return;
    }

    const payoutRows = (wdRows || []).map((w) => ({
      id: `TX-WDR-${String(w.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      date: w.paid_at || w.approved_at || w.requested_at,
      customer: 'InGo Payouts',
      order: '—',
      amount: Number(w.amount) || 0,
      type: 'Payout',
      st: payoutStatusLabel(w.status),
    }));

    const tx = [...salesRows, ...payoutRows].sort(
      (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
    );
    setRows(tx);
    setWithdrawals(wdRows || []);
    setLoading(false);
  }, [session?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const monthSales = rows.filter((r) => r.type === 'Sale' && new Date(r.date) >= monthStart);
    const monthRefunds = rows.filter((r) => r.type === 'Refund' && new Date(r.date) >= monthStart);
    const monthPayouts = withdrawals.filter((w) => new Date(w.requested_at || w.paid_at || 0) >= monthStart);
    const revenue = monthSales.reduce((s, r) => s + r.amount, 0);
    const refunds = monthRefunds.reduce((s, r) => s + r.amount, 0);
    const net = Math.max(0, revenue - refunds);
    const pendingPayout = monthPayouts
      .filter((w) => ['pending', 'approved'].includes(String(w.status || '').toLowerCase()))
      .reduce((s, w) => s + (Number(w.amount) || 0), 0);
    const completedPayout = monthPayouts
      .filter((w) => String(w.status || '').toLowerCase() === 'paid')
      .reduce((s, w) => s + (Number(w.amount) || 0), 0);
    return { revenue, pendingPayout, completedPayout, net };
  }, [monthStart, rows, withdrawals]);

  const availableToWithdraw = useMemo(
    () => Math.max(0, summary.net - summary.pendingPayout - summary.completedPayout),
    [summary],
  );

  const invoices = useMemo(() => {
    const paid = withdrawals.filter((w) => String(w.status || '').toLowerCase() === 'paid');
    return paid.map((w, idx) => ({
      num: `INV-SHOP-${String(idx + 1).padStart(4, '0')}`,
      date: formatDt(w.paid_at || w.requested_at),
      orders: '—',
      amount: Number(w.amount) || 0,
      st: 'Paid',
    }));
  }, [withdrawals]);

  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        if (f === 'All') return true;
        if (f === 'Sales') return r.type === 'Sale';
        if (f === 'Payouts') return r.type === 'Payout';
        if (f === 'Refunds') return r.type === 'Refund';
        return true;
      }),
    [f, rows],
  );

  const showTxEmpty = !loading && filteredRows.length === 0;

  const submitWithdrawal = async () => {
    setErr('');
    setMsg('');
    if (!session?.id || !supabase) {
      setErr('Shop owner session is missing.');
      return;
    }
    const n = Number(String(amount).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Enter a valid amount.');
      return;
    }
    if (n > availableToWithdraw) {
      setErr('Amount exceeds available balance.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('shop_owner_withdrawal_requests').insert({
      shop_owner_id: session.id,
      amount: Math.round(n * 100) / 100,
      status: 'pending',
    });
    setBusy(false);
    if (error) {
      setErr(error.message || 'Could not send request.');
      return;
    }
    setAmount('');
    setMsg('Withdrawal request sent to admin.');
    await load();
  };

  return (
    <div className="sopay-page">
      <div className="sopay-head">
        <h1>Payments</h1>
        <label className="sopay-date-btn">
          <IcCalendar />
          <input type="text" value={monthLabel} readOnly aria-label="Date range" />
        </label>
      </div>

      {loadError ? (
        <div className="sopay-error" role="alert">
          <p>{loadError}</p>
        </div>
      ) : null}

      <section className="sopay-hero" aria-label="Total revenue">
        <p className="sopay-hero-label">Total Revenue</p>
        <p className="sopay-hero-value">{formatGBP(summary.revenue)}</p>
        <p className="sopay-hero-sub">This month</p>
      </section>

      <div className="sopay-stats" role="group" aria-label="Payout summary">
        <article className="sopay-stat">
          <p className="sopay-stat-label">Pending payout</p>
          <p className="sopay-stat-value">{formatGBP(summary.pendingPayout)}</p>
          <span className="sopay-pill-processing">Processing</span>
        </article>
        <article className="sopay-stat">
          <p className="sopay-stat-label">Completed payouts</p>
          <p className="sopay-stat-value sopay-stat-value--blue">{formatGBP(summary.completedPayout)}</p>
          <p className="sopay-stat-foot">This month</p>
        </article>
      </div>

      <section className="sopay-payout" aria-labelledby="sopay-payout-title">
        <h2 id="sopay-payout-title">Payout Account</h2>
        <p className="sopay-account-line">
          <strong>{session?.business_name || 'Shop account'}</strong> · {session?.email || 'No email on file'}
          <span className="sopay-badge-primary">Primary</span>
        </p>
        <p className="sopay-available">
          Available to withdraw: <strong>{formatGBP(availableToWithdraw)}</strong>
        </p>
        <div className="sopay-withdraw-row">
          <div className="sopay-amount-wrap">
            <span className="sopay-amount-prefix" aria-hidden>
              �$
            </span>
            <input
              type="text"
              className="sopay-amount-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              aria-label="Withdrawal amount"
            />
          </div>
          <button type="button" className="sopay-btn-withdraw-all" onClick={() => setAmount(String(availableToWithdraw.toFixed(2)))}>
            Withdraw All
          </button>
          <button type="button" className="sopay-btn-withdraw" onClick={submitWithdrawal} disabled={busy}>
            {busy ? 'Sending…' : 'Withdraw'}
          </button>
        </div>
        {msg ? (
          <p className="sopay-flash sopay-flash--ok" role="status">
            {msg}
          </p>
        ) : null}
        {err ? (
          <p className="sopay-flash sopay-flash--err" role="alert">
            {err}
          </p>
        ) : null}
      </section>

      <div className="sopay-sec-head">
        <h2>Transaction History</h2>
        <button type="button" className="sopay-btn-refresh" aria-label="Refresh" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="sopay-tabs" role="tablist" aria-label="Filter transactions">
        {TX_FILT.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            className={f === p ? 'sopay-tab sopay-tab--on' : 'sopay-tab'}
            aria-selected={f === p}
            onClick={() => setF(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="sopay-table-card">
        {showTxEmpty ? (
          <div className="sopay-table-empty-wrap" role="status">
            <IcTxEmpty />
            <p>No transactions in this filter.</p>
          </div>
        ) : (
          <div className="sopay-table-scroll">
            <table className="sopay-table" aria-label="Transactions">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Order ID</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="sopay-table-loading">
                      Loading transactions…
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td style={{ fontSize: '0.75rem' }}>{formatDt(r.date)}</td>
                      <td>{r.customer}</td>
                      <td>{r.order}</td>
                      <td>
                        <span className={r.type === 'Refund' || r.type === 'Payout' ? 'sopay-amount-neg' : 'sopay-amount-pos'}>
                          {r.type === 'Refund' || r.type === 'Payout' ? '−' : '+'}
                          {formatGBP(r.amount)}
                        </span>
                      </td>
                      <td>
                        <span className={txTypeClass(r.type)}>{r.type}</span>
                      </td>
                      <td>
                        <span className={txStatusClass(r.st)}>{r.st}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="sopay-invoices" aria-labelledby="sopay-inv-title">
        <h2 id="sopay-inv-title">Invoices</h2>
        <div className="sopay-invoice-card">
          {invoices.length === 0 ? (
            <div className="sopay-invoice-empty" role="status">
              <IcInvoiceEmpty />
              <p>No paid payout invoices yet.</p>
            </div>
          ) : (
            <div className="sopay-invoice-list">
              {invoices.map((inv) => (
                <div key={inv.num} className="sopay-invoice-row">
                  <div>
                    <a href="#inv" onClick={(e) => e.preventDefault()}>
                      {inv.num}
                    </a>
                    <span className="sopay-invoice-meta">
                      {inv.date} · {inv.orders} orders
                    </span>
                  </div>
                  <div className="sopay-invoice-right">
                    <span className="sopay-invoice-amt">{formatGBP(inv.amount)}</span>
                    <span className="sopay-badge-paid">Paid</span>
                    <button type="button" className="sopay-pdf-btn" aria-label="Download PDF">
                      <IcPdf />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
