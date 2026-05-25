import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const filters = ['All', 'Sales', 'Payouts', 'Refunds', 'Commissions'];

function startOfCalendarMonthLocal(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatTxDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortRef(prefix, id) {
  if (!id) return '—';
  const short = String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${short}`;
}

function isCancelledBooking(status) {
  return String(status || '').toLowerCase() === 'cancelled';
}

function orderAmount(row, kind) {
  if (kind === 'delivery') return Number(row.total_amount || 0);
  if (kind === 'shop') return Number(row.subtotal || 0);
  return Number(row.quoted_price || 0);
}

function formatPaymentLabel(raw, kind) {
  if (kind === 'shop') {
    const g = String(raw?.payment_gateway || '').trim().toLowerCase();
    if (!g) return 'Checkout';
    if (g === 'paynow') return 'Paynow';
    return g.charAt(0).toUpperCase() + g.slice(1);
  }
  const p = String(raw || '').trim().toLowerCase();
  if (!p) return '—';
  if (p === 'ecocash') return 'Ecocash';
  if (p === 'cod') return 'COD';
  if (p === 'card') return 'Card';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function mapShopPayStatus(orderStatus, paymentStatus) {
  const ps = String(paymentStatus || '').toLowerCase();
  const os = String(orderStatus || '').toLowerCase();
  if (os === 'cancelled') return 'Cancelled';
  if (ps === 'paid') return 'Paid';
  if (ps === 'failed') return 'Failed';
  if (ps === 'cancelled') return 'Cancelled';
  if (ps === 'pending') return 'Pending payment';
  if (['placed', 'confirmed', 'fulfilled', 'delivered'].includes(os)) return 'Open';
  return orderStatus ? String(orderStatus).replace(/^./, (c) => c.toUpperCase()) : 'Open';
}

function mapDeliveryRideStatus(kind, status, paymentMethod) {
  const s = String(status || '').toLowerCase();
  if (kind === 'delivery') {
    if (s === 'cancelled') return 'Cancelled';
    if (s === 'paid' || s === 'placed') {
      const p = String(paymentMethod || '').toLowerCase();
      if (p === 'cod') return 'Cash on delivery';
      return 'Recorded';
    }
  }
  if (kind === 'taxi' || kind === 'tuk') {
    if (s === 'cancelled') return 'Cancelled';
    if (s === 'completed') return 'Completed';
    if (s === 'confirmed') return 'Confirmed';
    return 'Requested';
  }
  return status ? String(status) : '—';
}

/** @typedef {'Sale'|'Payout'|'Refund'|'Commission'} TxKind */

function typeClass(type) {
  const t = String(type || '');
  if (t === 'Sale') return 'admBadgeStatus admGreen';
  if (t === 'Payout') return 'admBadgeStatus admBlue';
  if (t === 'Refund') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admPurple';
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (['paid', 'completed', 'recorded'].includes(s)) return 'admBadgeStatus admGreen';
  if (['pending payment', 'pending', 'requested', 'open', 'approved'].includes(s)) return 'admBadgeStatus admOrange';
  if (['processing', 'confirmed', 'cash on delivery'].includes(s)) return 'admBadgeStatus admBlue';
  if (['failed', 'rejected', 'cancelled'].includes(s)) return 'admBadgeStatus admRed';
  if (s === 'estimated') return 'admBadgeStatus admPurple';
  return 'admBadgeStatus admOrange';
}

function withdrawalUiStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'paid') return 'Completed';
  if (s === 'approved') return 'Processing';
  if (s === 'pending') return 'Pending';
  if (s === 'rejected') return 'Rejected';
  return raw ? String(raw) : 'Pending';
}

export default function AdminTransactionsPage() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const [stats, setStats] = useState({ totalLines: 0, saleVolume: 0, pendingSettlement: 0 });

  /** @type {Array<{ id: string; type: TxKind; party: string; orderId: string; amount: string; method: string; status: string; date: string }>} */
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    setLoadErr('');
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setLoadErr('Database is not configured.');
      setRows([]);
      return;
    }

    const now = new Date();
    const monthStart = startOfCalendarMonthLocal(now);
    const monthStartIso = monthStart.toISOString();
    const nowIso = now.toISOString();
    /** @type {string[]} */
    const errs = [];

    try {
      setLoading(true);
      const [commRes, shopRes, delRes, txRes, tkRes, wResMonth] = await Promise.all([
        supabase.from('platform_commission_settings').select('driver_commission_percent, shop_commission_percent').eq('id', 1).maybeSingle(),
        supabase
          .from('shop_customer_orders')
          .select(
            'id, order_number, placed_at, subtotal, status, customer_full_name, payment_gateway, payment_status',
          )
          .gte('placed_at', monthStartIso)
          .lte('placed_at', nowIso)
          .order('placed_at', { ascending: false }),
        supabase
          .from('customer_delivery_orders')
          .select('id, created_at, total_amount, status, payment_method, app_user_id')
          .gte('created_at', monthStartIso)
          .lte('created_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('taxi_bookings')
          .select('id, created_at, quoted_price, status, app_user_id')
          .gte('created_at', monthStartIso)
          .lte('created_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('tuk_tuk_bookings')
          .select('id, created_at, quoted_price, status, app_user_id')
          .gte('created_at', monthStartIso)
          .lte('created_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('driver_withdrawal_requests')
          .select('id, driver_id, amount, status, requested_at, paid_at')
          .or(`requested_at.gte.${monthStartIso},paid_at.gte.${monthStartIso}`)
          .order('requested_at', { ascending: false }),
      ]);

      [
        shopRes,
        delRes,
        txRes,
        tkRes,
        wResMonth,
      ].forEach((r) => {
        if (r.error) errs.push(r.error.message);
      });
      if (commRes.error) errs.push(commRes.error.message);

      const withdrawalsQueueRes = await supabase
        .from('driver_withdrawal_requests')
        .select('amount')
        .in('status', ['pending', 'approved']);

      if (withdrawalsQueueRes.error) errs.push(withdrawalsQueueRes.error.message);
      const pendingSettlement = (withdrawalsQueueRes.data || []).reduce((s, w) => s + Number(w.amount || 0), 0);

      const shops = shopRes.data || [];
      const dels = delRes.data || [];
      const taxis = txRes.data || [];
      const tuks = tkRes.data || [];
      const driverPctNum = Number(commRes.data?.driver_commission_percent ?? 10);
      const shopPctNum = Number(commRes.data?.shop_commission_percent ?? 12);

      let rideGmvCompleted = 0;
      taxis.forEach((row) => {
        if (!isCancelledBooking(row.status) && String(row.status || '').toLowerCase() === 'completed') {
          rideGmvCompleted += orderAmount(row, 'ride');
        }
      });
      tuks.forEach((row) => {
        if (!isCancelledBooking(row.status) && String(row.status || '').toLowerCase() === 'completed') {
          rideGmvCompleted += orderAmount(row, 'ride');
        }
      });

      let deliveryGmv = 0;
      dels.forEach((row) => {
        if (!isCancelledBooking(row.status)) deliveryGmv += orderAmount(row, 'delivery');
      });

      let shopGmv = 0;
      shops.forEach((row) => {
        if (!isCancelledBooking(row.status)) shopGmv += orderAmount(row, 'shop');
      });

      const rideCommissionAmt = (driverPctNum / 100) * rideGmvCompleted;
      const deliveryCommissionAmt = (driverPctNum / 100) * deliveryGmv;
      const platformShopAmt = (shopPctNum / 100) * shopGmv;

      const userIds = new Set();
      dels.forEach((r) => {
        if (r.app_user_id) userIds.add(r.app_user_id);
      });
      taxis.forEach((r) => {
        if (r.app_user_id) userIds.add(r.app_user_id);
      });
      tuks.forEach((r) => {
        if (r.app_user_id) userIds.add(r.app_user_id);
      });

      const withdrawalById = new Map((wResMonth.data || []).map((w) => [w.id, w]));
      let withdrawals = [...withdrawalById.values()].sort(
        (a, b) => new Date(b.requested_at || 0).getTime() - new Date(a.requested_at || 0).getTime(),
      );

      const drvWxIds = [...new Set(withdrawals.map((w) => w.driver_id).filter(Boolean))];
      const driversNeeded = new Set(drvWxIds);

      const [usersRes, driversRes] = await Promise.all([
        userIds.size ? supabase.from('app_users').select('id, full_name').in('id', [...userIds]) : Promise.resolve({ data: [], error: null }),
        driversNeeded.size ? supabase.from('driver_registrations').select('id, full_name').in('id', [...driversNeeded]) : Promise.resolve({ data: [], error: null }),
      ]);
      if (usersRes.error) errs.push(usersRes.error.message);
      if (driversRes.error) errs.push(driversRes.error.message);

      const userMap = Object.fromEntries((usersRes.data || []).map((u) => [u.id, u.full_name]));
      const drvMap = Object.fromEntries((driversRes.data || []).map((d) => [d.id, d.full_name]));

      if (withdrawals.length < 16) {
        const recentW = await supabase
          .from('driver_withdrawal_requests')
          .select('id, driver_id, amount, status, requested_at, paid_at')
          .order('requested_at', { ascending: false })
          .limit(32);
        if (recentW.error) errs.push(recentW.error.message);
        (recentW.data || []).forEach((w) => withdrawalById.set(w.id, w));
        withdrawals = [...withdrawalById.values()].sort(
          (a, b) => new Date(b.requested_at || 0).getTime() - new Date(a.requested_at || 0).getTime(),
        );
        withdrawals.forEach((w) => {
          if (w.driver_id && !drvMap[w.driver_id]) driversNeeded.add(w.driver_id);
        });
        const missingDrv = [...driversNeeded].filter((id) => !drvMap[id]);
        if (missingDrv.length) {
          const fill = await supabase.from('driver_registrations').select('id, full_name').in('id', missingDrv);
          if (fill.error) errs.push(fill.error.message);
          (fill.data || []).forEach((d) => {
            drvMap[d.id] = d.full_name;
          });
        }
      }

      /** @type {typeof rows} */
      const list = [];

      shops.forEach((row) => {
        const amt = orderAmount(row, 'shop');
        list.push({
          id: `TRX-SHP-${String(row.id).replace(/-/g, '').slice(0, 8)}`,
          iso: row.placed_at,
          /** @type {TxKind} */
          type: isCancelledBooking(row.status) ? 'Refund' : 'Sale',
          party: row.customer_full_name?.trim() || '—',
          orderId: row.order_number || shortRef('SHP', row.id),
          amount: formatGBP(amt),
          amountNum: amt,
          method: formatPaymentLabel(row, 'shop'),
          status: mapShopPayStatus(row.status, row.payment_status),
          sortAt: new Date(row.placed_at || 0).getTime(),
        });
      });

      dels.forEach((row) => {
        const amt = orderAmount(row, 'delivery');
        const party = (userMap[row.app_user_id] || '').trim() || 'Guest';
        list.push({
          id: `TRX-DEL-${String(row.id).replace(/-/g, '').slice(0, 8)}`,
          iso: row.created_at,
          type: isCancelledBooking(row.status) ? 'Refund' : 'Sale',
          party,
          orderId: shortRef('DEL', row.id),
          amount: formatGBP(amt),
          amountNum: amt,
          method: formatPaymentLabel(row.payment_method, 'delivery'),
          status: mapDeliveryRideStatus('delivery', row.status, row.payment_method),
          sortAt: new Date(row.created_at || 0).getTime(),
        });
      });

      const rideRow = (row, label) => {
        const amt = orderAmount(row, 'ride');
        const party = (userMap[row.app_user_id] || '').trim() || 'Guest';
        list.push({
          id: `TRX-${label}-${String(row.id).replace(/-/g, '').slice(0, 8)}`,
          iso: row.created_at,
          type: isCancelledBooking(row.status) ? 'Refund' : 'Sale',
          party,
          orderId: shortRef(label, row.id),
          amount: formatGBP(amt),
          amountNum: amt,
          method: 'Quoted fare',
          status: mapDeliveryRideStatus('taxi', row.status),
          sortAt: new Date(row.created_at || 0).getTime(),
        });
      };
      taxis.forEach((row) => rideRow(row, 'TXI'));
      tuks.forEach((row) => rideRow(row, 'TUK'));

      withdrawals.forEach((w) => {
        const amt = Number(w.amount || 0);
        list.push({
          id: `TRX-WDR-${String(w.id).replace(/-/g, '').slice(0, 8)}`,
          iso: w.requested_at,
          type: 'Payout',
          party: (drvMap[w.driver_id] || '').trim() || 'Driver',
          orderId: shortRef('WDR', w.id),
          amount: formatGBP(amt),
          amountNum: amt,
          method: 'Withdrawal',
          status: withdrawalUiStatus(w.status),
          sortAt: new Date(w.requested_at || 0).getTime(),
        });
      });

      const commPieces = [
        {
          label: `Rides (${driverPctNum}%)`,
          amount: rideCommissionAmt,
          basis: `${formatGBP(rideGmvCompleted)} completed × ${driverPctNum}%`,
          id: 'c1',
        },
        {
          label: `Deliveries (${driverPctNum}%)`,
          amount: deliveryCommissionAmt,
          basis: `${formatGBP(deliveryGmv)} GMV × ${driverPctNum}%`,
          id: 'c2',
        },
        {
          label: `Shop (${shopPctNum}%)`,
          amount: platformShopAmt,
          basis: `${formatGBP(shopGmv)} GMV × ${shopPctNum}%`,
          id: 'c3',
        },
      ];

      commPieces.forEach((piece, idx) => {
        if (piece.amount < 0.005) return;
        list.push({
          id: `TRX-COMM-${piece.id}`,
          iso: monthStartIso,
          type: 'Commission',
          party: piece.label,
          orderId: piece.basis,
          amount: formatGBP(piece.amount),
          amountNum: piece.amount,
          method: 'Policy',
          status: 'Estimated',
          sortAt: Number.MAX_SAFE_INTEGER - idx - 2,
        });
      });

      list.sort((a, b) => b.sortAt - a.sortAt);

      const saleVolume = list.filter((r) => r.type === 'Sale').reduce((s, r) => s + Number(r.amountNum || 0), 0);

      setStats({
        totalLines: list.length,
        saleVolume,
        pendingSettlement,
      });
      setRows(
        list.map(({ sortAt, amountNum, iso, id, type, party, orderId, amount, method, status }) => ({
          id,
          type,
          party,
          orderId,
          amount,
          method,
          status,
          date: formatTxDate(iso),
        })),
      );

      setLastLoadedAt(Date.now());
      setLoadErr(errs.length ? errs.slice(0, 2).join(' — ') : '');
    } catch (e) {
      setLoadErr(e?.message || 'Could not load transactions.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const monthChip = useMemo(() => {
    const d = new Date();
    return `${d.toLocaleString(undefined, { month: 'long', year: 'numeric' })} · month-to-date`;
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const q = query.toLowerCase();
      const matchQ =
        !q ||
        row.id.toLowerCase().includes(q) ||
        row.orderId.toLowerCase().includes(q) ||
        row.party.toLowerCase().includes(q) ||
        row.amount.toLowerCase().includes(q);
      const mappedFilter =
        activeFilter === 'All'
          ? true
          : activeFilter === 'Sales'
            ? row.type === 'Sale'
            : activeFilter === 'Payouts'
              ? row.type === 'Payout'
              : activeFilter === 'Refunds'
                ? row.type === 'Refund'
                : row.type === 'Commission';
      return matchQ && mappedFilter;
    });
  }, [activeFilter, query, rows]);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <div className="admFilters">
          <span className="admDim admInput" style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.88rem' }}>
            {monthChip}
          </span>
        </div>
      </div>

      {loadErr ? (
        <p className="admModalErr" role="alert" style={{ marginBottom: '0.75rem' }}>
          {loadErr}
        </p>
      ) : null}

      <section className="admGrid3" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Ledger lines (MTD)</p>
          <p className="v">{loading ? '…' : stats.totalLines.toLocaleString()}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Customer sale volume</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : formatGBP(stats.saleVolume)}
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Pending settlements</p>
          <p className="v" style={{ color: '#ec9120' }}>
            {loading ? '…' : formatGBP(stats.pendingSettlement)}
          </p>
          <small className="admDim">Pending + approved withdrawals</small>
        </article>
      </section>

      {lastLoadedAt != null ? (
        <p className="admDim" style={{ fontSize: '0.76rem', margin: '0 0 0.5rem' }}>
          Last loaded {new Date(lastLoadedAt).toLocaleString()}
        </p>
      ) : null}

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admTabs" style={{ marginBottom: '0.5rem' }}>
          {filters.map((item) => (
            <button key={item} type="button" className={activeFilter === item ? 'active' : ''} onClick={() => setActiveFilter(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="admSearch">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transaction ID, order or user..." />
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Date &amp; Time</th>
                <th>Type</th>
                <th>Party</th>
                <th>Order ID</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="admDim" style={{ padding: '1rem', textAlign: 'center' }}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="admDim" style={{ padding: '1rem', textAlign: 'center' }}>
                    No rows match this slice for month-to-date.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td className="admDim">{row.date}</td>
                    <td>
                      <span className={typeClass(row.type)}>{row.type}</span>
                    </td>
                    <td>{row.party}</td>
                    <td>
                      <button className="admLink" type="button" disabled>
                        {row.orderId}
                      </button>
                    </td>
                    <td style={{ fontWeight: 700 }}>{row.amount}</td>
                    <td>{row.method}</td>
                    <td>
                      <span className={statusClass(row.status)}>{row.status}</span>
                    </td>
                    <td>
                      <div className="admActions">
                        <button type="button" aria-label="View" disabled title="Coming soon">
                          👁
                        </button>
                        <button type="button" aria-label="Download" disabled title="Coming soon">
                          ⬇
                        </button>
                        <button type="button" aria-label="Reverse" disabled title="Coming soon" style={{ color: '#bbb' }}>
                          ↺
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
