import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const txFilters = ['All', 'Sales', 'Driver Payouts', 'Refunds', 'Commission'];

function startOfCalendarMonthLocal(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function mtdComparisonWindow(monthStartNow, now) {
  const msPerDay = 86400000;
  const elapsedDays = Math.max(1, Math.ceil((now - monthStartNow) / msPerDay));
  const prevMonthStart = new Date(monthStartNow);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const prevWindowEnd = new Date(prevMonthStart.getTime() + elapsedDays * msPerDay - 1);
  return { prevMonthStart: prevMonthStart.toISOString(), prevWindowEnd: prevWindowEnd.toISOString(), elapsedDays };
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
  if (p === 'ecocash') return 'EcoCash';
  if (p === 'cod') return 'COD';
  if (p === 'card') return 'Card';
  if (p === 'stripe') return 'Card';
  if (p === 'wallet') return 'Wallet';
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

function typeClass(type) {
  const t = String(type || '');
  if (t === 'Sale') return 'admBadgeStatus admGreen';
  if (t === 'Driver Payout') return 'admBadgeStatus admBlue';
  if (t === 'Refund') return 'admBadgeStatus admRed';
  if (t === 'Commission') return 'admBadgeStatus admPurple';
  return 'admBadgeStatus admOrange';
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid' || s === 'completed' || s === 'recorded') return 'admBadgeStatus admGreen';
  if (['pending payment', 'pending', 'requested', 'open', 'approved'].includes(s)) return 'admBadgeStatus admOrange';
  if (s === 'processing' || s === 'confirmed') return 'admBadgeStatus admBlue';
  if (s === 'cash on delivery') return 'admBadgeStatus admBlue';
  if (['failed', 'rejected', 'cancelled'].includes(s)) return 'admBadgeStatus admRed';
  return 'admBadgeStatus admOrange';
}

function withdrawalStatusLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'paid') return 'Completed';
  if (s === 'approved') return 'Processing';
  if (s === 'pending') return 'Pending';
  if (s === 'rejected') return 'Rejected';
  return raw ? String(raw) : 'Pending';
}

const DONUT_PALETTE = [
  '#0A58A6',
  '#0A58A6',
  '#8d8fa3',
  '#8b52d6',
  '#ec9120',
  '#d34444',
];

function MethodDonut({ segments }) {
  const sum = segments.reduce((a, x) => a + x.value, 0);
  if (!sum || segments.length === 0) {
    return (
      <div className="admDonutWrap">
        <p className="admDim" style={{ margin: 0 }}>
          No attributed payment totals for this month yet.
        </p>
      </div>
    );
  }
  const norm = segments
    .filter((x) => x.value > 0)
    .map((x, i) => ({
      ...x,
      pct: (100 * x.value) / sum,
      color: x.color || DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
  let acc = 0;
  const parts = norm.map((x) => {
    const start = acc;
    acc += (x.value / sum) * 360;
    return `${x.color} ${start.toFixed(2)}deg ${acc.toFixed(2)}deg`;
  });
  return (
    <div className="admDonutWrap">
      <div
        className="admDonut"
        style={{
          background: `conic-gradient(${parts.join(', ')})`,
          boxSizing: 'border-box',
        }}
      >
        <div className="admDonutCenter">
          <strong>{formatGBP(sum)}</strong>
          <span>Attributed</span>
        </div>
      </div>
      <div className="admLegend">
        {norm.map((x) => (
          <p key={x.label}>
            <span className="admLegendDot" style={{ background: x.color, border: 'none' }} /> {x.label} —{' '}
            {x.pct.toFixed(0)}%
          </p>
        ))}
      </div>
    </div>
  );
}

export default function AdminPaymentsPage() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const [mtdRevenue, setMtdRevenue] = useState(0);
  const [revenueTrendPct, setRevenueTrendPct] = useState(null);
  const [platformEarnMtd, setPlatformEarnMtd] = useState(0);
  const [withdrawnPaidMtd, setWithdrawnPaidMtd] = useState(0);
  const [pendingWithdrawalSum, setPendingWithdrawalSum] = useState(0);

  const [transactions, setTransactions] = useState([]);
  const [methodSegments, setMethodSegments] = useState([]);
  const [withdrawalRows, setWithdrawalRows] = useState([]);
  const [refundRows, setRefundRows] = useState([]);
  const [commissionRows, setCommissionRows] = useState([]);

  const load = useCallback(async () => {
    setLoadErr('');
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setLoadErr('Database is not configured.');
      return;
    }
    const now = new Date();
    const monthStart = startOfCalendarMonthLocal(now);
    const monthStartIso = monthStart.toISOString();
    const nowIso = now.toISOString();

    const { prevMonthStart, prevWindowEnd } = mtdComparisonWindow(monthStart, now);

    /** @type {string[]} */
    const errs = [];

    try {
      setLoading(true);

      const [
        commRes,
        shopRes,
        delRes,
        txRes,
        tkRes,
        wResMonth,
        paidWithdrawQuery,
      ] = await Promise.all([
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
          .select(
            'id, created_at, total_amount, status, payment_method, app_user_id, pickup_location, dropoff_location',
          )
          .gte('created_at', monthStartIso)
          .lte('created_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('taxi_bookings')
          .select('id, created_at, quoted_price, status, app_user_id, pickup_location, destination_location')
          .gte('created_at', monthStartIso)
          .lte('created_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('tuk_tuk_bookings')
          .select('id, created_at, quoted_price, status, app_user_id, pickup_location, destination_location')
          .gte('created_at', monthStartIso)
          .lte('created_at', nowIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('driver_withdrawal_requests')
          .select('id, driver_id, amount, status, requested_at, paid_at')
          .or(`requested_at.gte.${monthStartIso},paid_at.gte.${monthStartIso}`)
          .order('requested_at', { ascending: false }),
        supabase
          .from('driver_withdrawal_requests')
          .select('amount, paid_at')
          .eq('status', 'paid')
          .gte('paid_at', monthStartIso)
          .lte('paid_at', nowIso),
      ]);

      if (shopRes.error) errs.push(shopRes.error.message);
      if (delRes.error) errs.push(delRes.error.message);
      if (txRes.error) errs.push(txRes.error.message);
      if (tkRes.error) errs.push(tkRes.error.message);
      if (wResMonth.error) errs.push(wResMonth.error.message);
      if (paidWithdrawQuery.error) errs.push(paidWithdrawQuery.error.message);
      const driverPctNum = Number(commRes.data?.driver_commission_percent ?? 10);
      const shopPctNum = Number(commRes.data?.shop_commission_percent ?? 12);
      if (commRes.error) errs.push(commRes.error.message);

      const withdrawalsAllRes = await supabase
        .from('driver_withdrawal_requests')
        .select('id, driver_id, amount, status, requested_at')
        .in('status', ['pending', 'approved'])
        .order('requested_at', { ascending: false })
        .limit(50);
      if (withdrawalsAllRes.error) errs.push(withdrawalsAllRes.error.message);

      const shops = shopRes.data || [];
      const dels = delRes.data || [];
      const taxis = txRes.data || [];
      const tuks = tkRes.data || [];

      /** MTD sums */
      const sumGmv = (rows, kind, allowCancelled = false) =>
        rows.reduce((sum, row) => {
          if (!allowCancelled && isCancelledBooking(row.status)) return sum;
          return sum + Math.max(0, orderAmount(row, kind === 'delivery' ? 'delivery' : kind === 'shop' ? 'shop' : 'ride'));
        }, 0);

      let rideGmvMtdCompleted = 0;
      taxis.forEach((row) => {
        if (!isCancelledBooking(row.status) && String(row.status || '').toLowerCase() === 'completed')
          rideGmvMtdCompleted += orderAmount(row, 'ride');
      });
      tuks.forEach((row) => {
        if (!isCancelledBooking(row.status) && String(row.status || '').toLowerCase() === 'completed')
          rideGmvMtdCompleted += orderAmount(row, 'ride');
      });

      let deliveryGmvDelivered = 0;
      dels.forEach((row) => {
        if (!isCancelledBooking(row.status) && String(row.status || '').toLowerCase() !== 'cancelled')
          deliveryGmvDelivered += orderAmount(row, 'delivery');
      });

      let shopGmvPaid = 0;
      shops.forEach((row) => {
        if (isCancelledBooking(row.status)) return;
        shopGmvPaid += orderAmount(row, 'shop');
      });

      const mtdTotal = sumGmv(dels, 'delivery') + sumGmv(taxis, 'ride') + sumGmv(tuks, 'ride') + sumGmv(shops, 'shop');

      const rideCommissionAmt = (driverPctNum / 100) * rideGmvMtdCompleted;
      const deliveryCommissionAmt = (driverPctNum / 100) * deliveryGmvDelivered;
      const platformShopAmt = (shopPctNum / 100) * shopGmvPaid;
      const platformTotal = rideCommissionAmt + deliveryCommissionAmt + platformShopAmt;

      /** Prior MTD comparison */
      const [prevDel, prevTx, prevTk, prevShop] = await Promise.all([
        supabase
          .from('customer_delivery_orders')
          .select('total_amount, status')
          .gte('created_at', prevMonthStart)
          .lte('created_at', prevWindowEnd),
        supabase.from('taxi_bookings').select('quoted_price, status').gte('created_at', prevMonthStart).lte('created_at', prevWindowEnd),
        supabase.from('tuk_tuk_bookings').select('quoted_price, status').gte('created_at', prevMonthStart).lte('created_at', prevWindowEnd),
        supabase.from('shop_customer_orders').select('subtotal, status').gte('placed_at', prevMonthStart).lte('placed_at', prevWindowEnd),
      ]);
      [prevDel, prevTx, prevTk, prevShop].forEach((r) => {
        if (r.error) errs.push(r.error.message);
      });
      const prevMtdTotal =
        sumGmv(prevDel.data || [], 'delivery') +
        sumGmv(prevTx.data || [], 'ride') +
        sumGmv(prevTk.data || [], 'ride') +
        sumGmv(prevShop.data || [], 'shop');
      let trend = null;
      if (prevMtdTotal > 0) trend = Math.round(((mtdTotal - prevMtdTotal) / prevMtdTotal) * 100);

      const paidWithdrawMtd = (paidWithdrawQuery.data || []).reduce((s, row) => s + Number(row.amount || 0), 0);

      const pendingRows = withdrawalsAllRes.data || [];
      const pendingSum = pendingRows.reduce((s, w) => s + Number(w.amount || 0), 0);

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

      const driverIdsPending = [...new Set(pendingRows.map((w) => w.driver_id).filter(Boolean))];

      const [usersLookup, drvLookup] = await Promise.all([
        userIds.size
          ? supabase.from('app_users').select('id, full_name').in('id', [...userIds])
          : Promise.resolve({ data: [], error: null }),
        driverIdsPending.length
          ? supabase.from('driver_registrations').select('id, full_name').in('id', driverIdsPending)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (usersLookup.error) errs.push(usersLookup.error.message);
      if (drvLookup.error) errs.push(drvLookup.error.message);

      const userMap = Object.fromEntries((usersLookup.data || []).map((u) => [u.id, u.full_name]));

      /** Method mix (GMV attribution) — rides grouped */
      const methodBucket = {};
      const addBucket = (label, amt) => {
        if (amt <= 0) return;
        methodBucket[label] = (methodBucket[label] || 0) + amt;
      };
      dels.forEach((row) => {
        if (isCancelledBooking(row.status)) return;
        addBucket(formatPaymentLabel(row.payment_method, 'delivery'), orderAmount(row, 'delivery'));
      });
      taxis.forEach((row) => {
        if (isCancelledBooking(row.status)) return;
        addBucket('Ride (quoted)', orderAmount(row, 'ride'));
      });
      tuks.forEach((row) => {
        if (isCancelledBooking(row.status)) return;
        addBucket('Ride (quoted)', orderAmount(row, 'ride'));
      });
      shops.forEach((row) => {
        if (isCancelledBooking(row.status)) return;
        addBucket(formatPaymentLabel(row, 'shop'), orderAmount(row, 'shop'));
      });

      const segSorted = Object.entries(methodBucket)
        .map(([label, value], i) => ({ label, value, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }))
        .sort((a, b) => b.value - a.value);

      const drvNameMap = Object.fromEntries((drvLookup.data || []).map((d) => [d.id, d.full_name]));

      /** Transactions */
      /** @type {typeof transactions} */
      const tx = [];

      shops.forEach((row) => {
        const amt = orderAmount(row, 'shop');
        tx.push({
          id: `TX-SHP-${String(row.id).replace(/-/g, '').slice(0, 8)}`,
          date: row.placed_at,
          iso: row.placed_at,
          type: isCancelledBooking(row.status) ? 'Refund' : 'Sale',
          actor: row.customer_full_name?.trim() || '—',
          order: row.order_number || shortRef('SHP', row.id),
          amountNum: amt,
          amount: formatGBP(amt),
          method: formatPaymentLabel(row, 'shop'),
          status: mapShopPayStatus(row.status, row.payment_status),
          sortKey: new Date(row.placed_at || 0).getTime(),
        });
      });

      dels.forEach((row) => {
        const amt = orderAmount(row, 'delivery');
        const actor = (userMap[row.app_user_id] || '').trim() || 'Guest';
        tx.push({
          id: `TX-DEL-${String(row.id).replace(/-/g, '').slice(0, 8)}`,
          date: row.created_at,
          iso: row.created_at,
          type: isCancelledBooking(row.status) ? 'Refund' : 'Sale',
          actor,
          order: shortRef('DEL', row.id),
          amountNum: amt,
          amount: formatGBP(amt),
          method: formatPaymentLabel(row.payment_method, 'delivery'),
          status: mapDeliveryRideStatus('delivery', row.status, row.payment_method),
          sortKey: new Date(row.created_at || 0).getTime(),
        });
      });

      const pushRideRow = (row, label) => {
        const amt = orderAmount(row, 'ride');
        const actor = (userMap[row.app_user_id] || '').trim() || 'Guest';
        tx.push({
          id: `TX-${label}-${String(row.id).replace(/-/g, '').slice(0, 8)}`,
          date: row.created_at,
          iso: row.created_at,
          type: isCancelledBooking(row.status) ? 'Refund' : 'Sale',
          actor,
          order: shortRef(label, row.id),
          amountNum: amt,
          amount: formatGBP(amt),
          method: 'Quoted fare',
          status: mapDeliveryRideStatus('taxi', row.status),
          sortKey: new Date(row.created_at || 0).getTime(),
        });
      };
      taxis.forEach((row) => pushRideRow(row, 'TXI'));
      tuks.forEach((row) => pushRideRow(row, 'TUK'));

      /** Withdrawals for activity table (month touch + top-up recent, deduped by id) */
      const withdrawalById = new Map();
      (wResMonth.data || []).forEach((w) => withdrawalById.set(w.id, w));
      let wRowsList = [...withdrawalById.values()].sort(
        (a, b) => new Date(b.requested_at || 0).getTime() - new Date(a.requested_at || 0).getTime(),
      );
      if (wRowsList.length < 20) {
        const recentW = await supabase
          .from('driver_withdrawal_requests')
          .select('id, driver_id, amount, status, requested_at, paid_at')
          .order('requested_at', { ascending: false })
          .limit(40);
        if (recentW.error) errs.push(recentW.error.message);
        recentW.data?.forEach((w) => withdrawalById.set(w.id, w));
        wRowsList = [...withdrawalById.values()].sort(
          (a, b) => new Date(b.requested_at || 0).getTime() - new Date(a.requested_at || 0).getTime(),
        );
      }

      const drvIdsWx = [...new Set(wRowsList.map((w) => w.driver_id).filter(Boolean))];
      let drvWxMap = { ...drvNameMap };
      if (drvIdsWx.some((id) => !drvWxMap[id])) {
        const { data: drvM, error: de } = await supabase.from('driver_registrations').select('id, full_name').in('id', drvIdsWx);
        if (de) errs.push(de.message);
        (drvM || []).forEach((d) => {
          drvWxMap[d.id] = d.full_name;
        });
      }

      wRowsList.forEach((w) => {
        const amt = Number(w.amount || 0);
        tx.push({
          id: `TX-WDR-${String(w.id).replace(/-/g, '').slice(0, 8)}`,
          date: w.paid_at || w.requested_at,
          iso: w.requested_at,
          type: 'Driver Payout',
          actor: (drvWxMap[w.driver_id] || '').trim() || 'Driver',
          order: shortRef('WDR', w.id),
          amountNum: amt,
          amount: formatGBP(amt),
          method: 'Withdrawal',
          status: withdrawalStatusLabel(w.status),
          sortKey: new Date(w.requested_at || 0).getTime(),
        });
      });

      const commPieces = [];
      commPieces.push({
        label: `Rides (${driverPctNum}% est.)`,
        amount: rideCommissionAmt,
        basis: `${formatGBP(rideGmvMtdCompleted)} completed ride GMV × ${driverPctNum}%`,
      });
      commPieces.push({
        label: `Deliveries (${driverPctNum}% est.)`,
        amount: deliveryCommissionAmt,
        basis: `${formatGBP(deliveryGmvDelivered)} recorded delivery GMV × ${driverPctNum}%`,
      });
      commPieces.push({
        label: `Shop checkout (${shopPctNum}% est.)`,
        amount: platformShopAmt,
        basis: `${formatGBP(shopGmvPaid)} shop GMV (excl. cancelled) × ${shopPctNum}%`,
      });

      commPieces.forEach((piece, idx) => {
        if (!piece.amount) return;
        tx.push({
          id: `TX-CMM-${idx + 1}`,
          date: nowIso,
          iso: monthStartIso,
          type: 'Commission',
          actor: piece.label,
          order: piece.basis,
          amountNum: piece.amount,
          amount: formatGBP(piece.amount),
          method: 'Policy',
          status: 'Estimated',
          sortKey: Number.MAX_SAFE_INTEGER - idx - 1000,
        });
      });

      tx.sort((a, b) => b.sortKey - a.sortKey);

      /** Refunds & withdrawal UI lists */
      const refundsList = shops
        .filter((row) => isCancelledBooking(row.status))
        .map((row) => ({
          ref: row.order_number || shortRef('SHP', row.id),
          customer: row.customer_full_name?.trim() || '—',
          reason: 'Order cancelled',
          amount: formatGBP(orderAmount(row, 'shop')),
          date: formatTxDate(row.placed_at),
        }))
        .concat(
          dels
            .filter((row) => isCancelledBooking(row.status))
            .map((row) => ({
              ref: shortRef('DEL', row.id),
              customer: userMap[row.app_user_id] || 'Guest',
              reason: 'Delivery cancelled',
              amount: formatGBP(orderAmount(row, 'delivery')),
              date: formatTxDate(row.created_at),
            })),
        )
        .concat(
          taxis
            .filter((row) => isCancelledBooking(row.status))
            .map((row) => ({
              ref: shortRef('TXI', row.id),
              customer: userMap[row.app_user_id] || 'Guest',
              reason: 'Ride cancelled',
              amount: formatGBP(orderAmount(row, 'ride')),
              date: formatTxDate(row.created_at),
            })),
          tuks
            .filter((row) => isCancelledBooking(row.status))
            .map((row) => ({
              ref: shortRef('TUK', row.id),
              customer: userMap[row.app_user_id] || 'Guest',
              reason: 'Ride cancelled',
              amount: formatGBP(orderAmount(row, 'ride')),
              date: formatTxDate(row.created_at),
            })),
        )
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const payoutsUi = pendingRows.map((w) => ({
        id: w.id,
        name: drvWxMap[w.driver_id] || 'Driver',
        amountReq: formatGBP(w.amount),
        status: withdrawalStatusLabel(w.status),
        when: formatTxDate(w.requested_at),
        raw: w.amount,
      }));

      setCommissionRows(
        commPieces
          .map((piece, idx) => ({ id: `COMM-${idx + 1}`, label: piece.label, amountNum: piece.amount, detail: piece.basis }))
          .filter((row) => row.amountNum >= 0.005),
      );

      setMtdRevenue(mtdTotal);
      setRevenueTrendPct(trend);
      setPlatformEarnMtd(platformTotal);
      setWithdrawnPaidMtd(paidWithdrawMtd);
      setPendingWithdrawalSum(pendingSum);
      setMethodSegments(segSorted);
      setTransactions(tx);
      setWithdrawalRows(payoutsUi);
      setRefundRows(refundsList);
      setLastLoadedAt(Date.now());

      setLoadErr(errs.length ? errs.slice(0, 3).join(' — ') : '');
    } catch (e) {
      setLoadErr(e?.message || 'Could not load payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((txRow) => {
      const hay = `${txRow.id} ${txRow.order} ${txRow.actor} ${txRow.amount}`.toLowerCase();
      const matchQ = !q || hay.includes(q);

      let matchFilter = true;
      if (activeFilter === 'Sales') matchFilter = txRow.type === 'Sale';
      else if (activeFilter === 'Driver Payouts') matchFilter = txRow.type === 'Driver Payout';
      else if (activeFilter === 'Refunds') matchFilter = txRow.type === 'Refund';
      else if (activeFilter === 'Commission') matchFilter = txRow.type === 'Commission';
      return matchQ && matchFilter;
    });
  }, [activeFilter, search, transactions]);

  const monthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }, []);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <div className="admFilters">
          <span className="admDim admInput" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {monthLabel}
            {' · '}month-to-date
          </span>
        </div>
      </div>

      {loadErr ? (
        <p className="admModalErr" role="alert">
          {loadErr}
        </p>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admRevenueGradient">
          <p>Total revenue ({monthLabel} MTD)</p>
          <h3>{formatGBP(mtdRevenue)}</h3>
          <small>Bookings except cancelled rides / orders</small>
          <div>
            {loading
              ? 'Loading…'
              : revenueTrendPct == null || Number.isNaN(revenueTrendPct)
                ? '— vs same window last month'
                : revenueTrendPct > 0
                  ? `↑ +${revenueTrendPct}% vs same window last month`
                  : revenueTrendPct < 0
                    ? `↓ ${revenueTrendPct}% vs same window last month`
                    : 'same as same window last month'}
          </div>
        </article>
        <article className="admCard">
          <p className="admDim" style={{ marginTop: 0 }}>
            Withdrawals settled (estimated)
          </p>
          <h3 style={{ margin: '0.1rem 0' }}>{formatGBP(withdrawnPaidMtd)}</h3>
          <p className="admDim">Requests marked paid this month where available</p>
          <span className="admBadgeStatus admGreen">Live data</span>
        </article>
        <article className="admCard">
          <p className="admDim" style={{ marginTop: 0 }}>
            Estimated platform earnings
          </p>
          <h3 style={{ margin: '0.1rem 0', color: '#0A58A6' }}>{formatGBP(platformEarnMtd)}</h3>
          <p className="admDim">From commission rates (rides delivered + deliveries + shop GMV)</p>
        </article>
        <article className="admCard">
          <p className="admDim" style={{ marginTop: 0 }}>Outstanding withdrawal requests</p>
          <h3 style={{ margin: '0.1rem 0', color: '#ec9120' }}>{formatGBP(pendingWithdrawalSum)}</h3>
          <p style={{ color: '#ec9120' }}>Pending or approved drivers</p>
        </article>
      </section>

      {lastLoadedAt != null ? (
        <p className="admDim" style={{ fontSize: '0.76rem', margin: '0 0 0.6rem' }}>
          Last loaded {new Date(lastLoadedAt).toLocaleString()}
        </p>
      ) : null}

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader">
          <h3>Revenue by attributed method</h3>
        </div>
        <MethodDonut segments={methodSegments} />
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader"><h3>All transactions</h3></div>
        <div className="admTabs" style={{ marginBottom: '0.45rem' }}>
          {txFilters.map((filter) => (
            <button key={filter} type="button" className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)}>
              {filter}
            </button>
          ))}
        </div>
        <div className="admSearch" style={{ marginBottom: '0.7rem' }}>
          <input placeholder="Search ID, order, actor, amount…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Date &amp; Time</th>
                <th>Type</th>
                <th>Customer / driver</th>
                <th>Order / detail</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="admDim" style={{ padding: '1rem', textAlign: 'center' }}>
                    Loading…
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="admDim" style={{ padding: '1rem', textAlign: 'center' }}>
                    Nothing in this slice for month-to-date. Try Refresh or widen filters.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((txRow) => (
                  <tr key={txRow.id}>
                    <td>{txRow.id}</td>
                    <td className="admDim">{formatTxDate(txRow.iso || txRow.date)}</td>
                    <td>
                      <span className={typeClass(txRow.type)}>{txRow.type}</span>
                    </td>
                    <td>{txRow.actor}</td>
                    <td>
                      <span className={txRow.type === 'Commission' ? 'admDim' : ''}>{txRow.order}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{txRow.amount}</td>
                    <td>{txRow.method}</td>
                    <td>
                      <span className={statusClass(txRow.status)}>{txRow.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader">
          <h3>Outstanding withdrawal requests</h3>
          <button className="admBtnSmall" type="button" disabled title="Handle in payouts workflow">
            Process all
          </button>
        </div>
        {withdrawalRows.length === 0 ? (
          <p className="admDim">No pending or approved withdrawals in the queue.</p>
        ) : (
          withdrawalRows.map((payout) => (
            <div key={payout.id} className="admPayoutRow">
              <div className="admInlineUser">
                <span className="admMiniAvatar">{payout.name.slice(0, 2).toUpperCase()}</span>
                {payout.name}
              </div>
              <div style={{ fontWeight: 700 }}>{payout.amountReq}</div>
              <div className="admDim">{payout.when}</div>
              <div>
                <span className={statusClass(payout.status)}>{payout.status}</span>
              </div>
              <button className="admBtnSmall" type="button" disabled>
                Record paid
              </button>
              <button className="admWarnBtnSmall" type="button" disabled>
                Hold
              </button>
            </div>
          ))
        )}
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader">
          <h3>Estimated commissions (same period)</h3>
          <p className="admDim" style={{ margin: 0 }}>
            Uses platform rates from settings
          </p>
        </div>
        {commissionRows.length === 0 ? (
          <p className="admDim">Nothing to derive yet.</p>
        ) : (
          <>
            {commissionRows.map((item) => (
              <div key={item.id} className="admRefundRow">
                <div style={{ fontWeight: 700 }}>{item.label}</div>
                <div className="admDim">{item.detail}</div>
                <div style={{ fontWeight: 800 }}>{formatGBP(item.amountNum)}</div>
              </div>
            ))}
            <div style={{ marginTop: '0.65rem' }}>
              <strong>Total estimate: </strong>
              {formatGBP(platformEarnMtd)}
            </div>
          </>
        )}
      </section>

      <section className="admCard">
        <div className="admSectionHeader">
          <h3>Cancelled bookings (refunds not tracked separately)</h3>
        </div>
        {refundRows.length === 0 ? (
          <p className="admDim">No cancelled shop, delivery or ride rows this month-to-date.</p>
        ) : (
          refundRows.map((item) => (
            <div key={`${item.ref}-${item.date}-${item.reason}`} className="admRefundRow">
              <button className="admLink" type="button" disabled>
                {item.ref}
              </button>
              <div>{item.customer}</div>
              <div className="admDim">{item.reason}</div>
              <div style={{ fontWeight: 700 }}>{item.amount}</div>
              <div className="admDim">{item.date}</div>
              <button className="admBtnSmall" type="button" disabled>
                Approve
              </button>
              <button className="admDangerSmall" type="button" disabled>
                Reject
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
