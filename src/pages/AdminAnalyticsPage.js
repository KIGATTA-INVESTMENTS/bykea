import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

const PERIOD_DAYS = 28;

/** @typedef {{ pickup_location?: string, destination_location?: string, dropoff_location?: string, customer_address?: string, placed_at?: string, created_at?: string, status?: string, total_amount?: unknown, quoted_price?: unknown, subtotal?: unknown }} AggRow */

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function between(iso, startIso, endIso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= new Date(startIso).getTime() && t <= new Date(endIso).getTime();
}

/** @param {string | undefined} raw */
function areaKey(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const seg = t.split(',')[0]?.trim()?.slice(0, 52) ?? '';
  return seg || null;
}

function pctVersusPrev(curr, prev) {
  if (prev <= 0 && curr > 0) return 'vs prior · new activity';
  if (prev <= 0) return 'vs prior · —';
  const p = Math.round(((curr - prev) / prev) * 100);
  if (p > 0) return `vs prior · +${p}%`;
  if (p < 0) return `vs prior · ${p}%`;
  return 'vs prior · flat';
}

function formatRateDelta(currRate, prevRate) {
  if (prevRate == null || currRate == null || Number.isNaN(prevRate) || Number.isNaN(currRate)) return 'prior period comparison · —';
  const dp = Math.round((currRate - prevRate) * 10) / 10;
  if (dp > 0) return `prior period · +${dp} pts`;
  if (dp < 0) return `prior period · ${dp} pts`;
  return 'prior period · no change';
}

function buildLast7DayBuckets() {
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push({
      key: dayKey(d),
      day: d.toLocaleDateString(undefined, { weekday: 'short' }),
      orders: 0,
      revenue: 0,
    });
  }
  return out;
}

function MiniBars({ weekly }) {
  const max = Math.max(1, ...weekly.map((item) => item.orders));
  return (
    <div className="admMiniBars">
      {weekly.map((item, idx) => (
        <div key={`${item.day}-${idx}`} className="admMiniBarCol">
          <div className="admMiniBarTrack">
            <div className="admMiniBarFill" style={{ height: `${(item.orders / max) * 100}%` }} />
          </div>
          <small>{item.day}</small>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const [totalOrdersCurr, setTotalOrdersCurr] = useState(0);
  const [totalOrdersPrev, setTotalOrdersPrev] = useState(0);
  const [revenueCurr, setRevenueCurr] = useState(0);
  const [revenuePrev, setRevenuePrev] = useState(0);
  const [newAccountsCurr, setNewAccountsCurr] = useState(0);
  const [newAccountsPrev, setNewAccountsPrev] = useState(0);
  const [completionCurr, setCompletionCurr] = useState(0);
  const [completionPrev, setCompletionPrev] = useState(0);

  const [weekly, setWeekly] = useState(() => buildLast7DayBuckets().map((b) => ({ day: b.day, orders: 0, revenue: 0 })));
  const [serviceMix, setServiceMix] = useState([
    { label: 'Delivery', value: 0, color: '#0A58A6' },
    { label: 'Taxi', value: 0, color: '#0A58A6' },
    { label: 'Tuk-Tuk', value: 0, color: '#0d9488' },
    { label: 'Shop', value: 0, color: '#7a43d6' },
  ]);
  const [areaRows, setAreaRows] = useState([]);

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setError('Database is not configured. Set your project URL and anon key in environment variables.');
      return;
    }

    setLoading(true);
    const errs = [];

    const now = new Date();
    const currEnd = endOfLocalDay(now).toISOString();
    const currStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PERIOD_DAYS - 1))).toISOString();
    const prevPeriodEnd = new Date(new Date(currStart).getTime() - 1);
    const prevEnd = endOfLocalDay(prevPeriodEnd).toISOString();
    const prevStart = startOfLocalDay(new Date(prevPeriodEnd.getFullYear(), prevPeriodEnd.getMonth(), prevPeriodEnd.getDate() - (PERIOD_DAYS - 1))).toISOString();

    try {
      const [{ count: nuCurr, error: ucErr }, { count: nuPrev, error: upErr }] = await Promise.all([
        supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('created_at', currStart).lte('created_at', currEnd),
        supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('created_at', prevStart).lte('created_at', prevEnd),
      ]);
      if (ucErr) errs.push(ucErr.message);
      if (upErr) errs.push(upErr.message);
      setNewAccountsCurr(Number(nuCurr ?? 0));
      setNewAccountsPrev(Number(nuPrev ?? 0));

      const [{ data: delRows, error: e1 }, { data: txRows, error: e2 }, { data: tkRows, error: e3 }, { data: shopRows, error: e4 }] =
        await Promise.all([
          supabase
            .from('customer_delivery_orders')
            .select('created_at, status, total_amount, pickup_location')
            .gte('created_at', prevStart)
            .lte('created_at', currEnd),
          supabase.from('taxi_bookings').select('created_at, status, quoted_price, pickup_location').gte('created_at', prevStart).lte('created_at', currEnd),
          supabase.from('tuk_tuk_bookings').select('created_at, status, quoted_price, pickup_location').gte('created_at', prevStart).lte('created_at', currEnd),
          supabase.from('shop_customer_orders').select('placed_at, status, subtotal, customer_address').gte('placed_at', prevStart).lte('placed_at', currEnd),
        ]);

      [e1, e2, e3, e4].forEach((er) => {
        if (er) errs.push(er.message);
      });

      /** @type {AggRow[]} */
      const dels = Array.isArray(delRows) ? delRows : [];
      /** @type {AggRow[]} */
      const txs = Array.isArray(txRows) ? txRows : [];
      /** @type {AggRow[]} */
      const tks = Array.isArray(tkRows) ? tkRows : [];
      /** @type {AggRow[]} */
      const shops = Array.isArray(shopRows) ? shopRows : [];

      const revenueExcludeCancelled = (status, amount) => {
        if (String(status || '').toLowerCase() === 'cancelled') return 0;
        const n = Number(amount || 0);
        return Number.isFinite(n) ? n : 0;
      };

      let oCurr = 0;
      let oPrev = 0;
      let rCurr = 0;
      let rPrev = 0;
      let doneCurr = 0;
      let donePrev = 0;
      let mixDelC = 0;
      let mixTxC = 0;
      let mixTkC = 0;
      let mixShopC = 0;

      const buckets = buildLast7DayBuckets();

      /** @type {Record<string, number>} */
      const areaCurr = {};
      /** @type {Record<string, number>} */
      const areaPrev = {};

      const weekStartIso = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)).toISOString();

      const bumpAreaCount = (loc, inC, inP) => {
        const k = areaKey(loc);
        if (!k) return;
        if (inC) areaCurr[k] = (areaCurr[k] || 0) + 1;
        if (inP) areaPrev[k] = (areaPrev[k] || 0) + 1;
      };

      dels.forEach((row) => {
        const iso = row.created_at;
        const inC = between(iso, currStart, currEnd);
        const inP = between(iso, prevStart, prevEnd);
        if (inC) {
          oCurr += 1;
          rCurr += revenueExcludeCancelled(row.status, row.total_amount);
          mixDelC += 1;
          if (String(row.status || '').toLowerCase() === 'delivered') doneCurr += 1;
          bumpAreaCount(row.pickup_location, true, false);
        }
        if (inP) {
          oPrev += 1;
          rPrev += revenueExcludeCancelled(row.status, row.total_amount);
          if (String(row.status || '').toLowerCase() === 'delivered') donePrev += 1;
          bumpAreaCount(row.pickup_location, false, true);
        }
        if (between(iso, weekStartIso, currEnd)) {
          const k = dayKey(new Date(iso));
          const b = buckets.find((x) => x.key === k);
          if (b) {
            b.orders += 1;
            b.revenue += revenueExcludeCancelled(row.status, row.total_amount);
          }
        }
      });

      txs.forEach((row) => {
        const iso = row.created_at;
        const inC = between(iso, currStart, currEnd);
        const inP = between(iso, prevStart, prevEnd);
        if (inC) {
          oCurr += 1;
          rCurr += revenueExcludeCancelled(row.status, row.quoted_price);
          mixTxC += 1;
          if (String(row.status || '').toLowerCase() === 'completed') doneCurr += 1;
          bumpAreaCount(row.pickup_location, true, false);
        }
        if (inP) {
          oPrev += 1;
          rPrev += revenueExcludeCancelled(row.status, row.quoted_price);
          if (String(row.status || '').toLowerCase() === 'completed') donePrev += 1;
          bumpAreaCount(row.pickup_location, false, true);
        }
        if (between(iso, weekStartIso, currEnd)) {
          const k = dayKey(new Date(iso));
          const b = buckets.find((x) => x.key === k);
          if (b) {
            b.orders += 1;
            b.revenue += revenueExcludeCancelled(row.status, row.quoted_price);
          }
        }
      });

      tks.forEach((row) => {
        const iso = row.created_at;
        const inC = between(iso, currStart, currEnd);
        const inP = between(iso, prevStart, prevEnd);
        if (inC) {
          oCurr += 1;
          rCurr += revenueExcludeCancelled(row.status, row.quoted_price);
          mixTkC += 1;
          if (String(row.status || '').toLowerCase() === 'completed') doneCurr += 1;
          bumpAreaCount(row.pickup_location, true, false);
        }
        if (inP) {
          oPrev += 1;
          rPrev += revenueExcludeCancelled(row.status, row.quoted_price);
          if (String(row.status || '').toLowerCase() === 'completed') donePrev += 1;
          bumpAreaCount(row.pickup_location, false, true);
        }
        if (between(iso, weekStartIso, currEnd)) {
          const k = dayKey(new Date(iso));
          const b = buckets.find((x) => x.key === k);
          if (b) {
            b.orders += 1;
            b.revenue += revenueExcludeCancelled(row.status, row.quoted_price);
          }
        }
      });

      shops.forEach((row) => {
        const iso = row.placed_at;
        const inC = between(iso, currStart, currEnd);
        const inP = between(iso, prevStart, prevEnd);
        if (inC) {
          oCurr += 1;
          rCurr += revenueExcludeCancelled(row.status, row.subtotal);
          mixShopC += 1;
          if (String(row.status || '').toLowerCase() === 'delivered') doneCurr += 1;
          bumpAreaCount(row.customer_address, true, false);
        }
        if (inP) {
          oPrev += 1;
          rPrev += revenueExcludeCancelled(row.status, row.subtotal);
          if (String(row.status || '').toLowerCase() === 'delivered') donePrev += 1;
          bumpAreaCount(row.customer_address, false, true);
        }
        if (between(iso, weekStartIso, currEnd)) {
          const k = dayKey(new Date(iso));
          const b = buckets.find((x) => x.key === k);
          if (b) {
            b.orders += 1;
            b.revenue += revenueExcludeCancelled(row.status, row.subtotal);
          }
        }
      });

      const rateCurr = oCurr > 0 ? (100 * doneCurr) / oCurr : 0;
      const ratePrev = oPrev > 0 ? (100 * donePrev) / oPrev : 0;
      setTotalOrdersCurr(oCurr);
      setTotalOrdersPrev(oPrev);
      setRevenueCurr(rCurr);
      setRevenuePrev(rPrev);
      setCompletionCurr(Math.round(rateCurr * 10) / 10);
      setCompletionPrev(Math.round(ratePrev * 10) / 10);

      const mixTotal = mixDelC + mixTxC + mixTkC + mixShopC || 1;
      setServiceMix([
        { label: 'Delivery', value: Math.round((1000 * mixDelC) / mixTotal) / 10, color: '#0A58A6' },
        { label: 'Taxi', value: Math.round((1000 * mixTxC) / mixTotal) / 10, color: '#0A58A6' },
        { label: 'Tuk-Tuk', value: Math.round((1000 * mixTkC) / mixTotal) / 10, color: '#0d9488' },
        { label: 'Shop', value: Math.round((1000 * mixShopC) / mixTotal) / 10, color: '#7a43d6' },
      ]);

      const topKeys = Object.entries(areaCurr)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([city]) => city);
      const areaTable = topKeys.map((city) => {
        const c = areaCurr[city] ?? 0;
        const p = areaPrev[city] ?? 0;
        let growth = '—';
        if (p <= 0 && c > 0) growth = 'new';
        else if (p > 0) growth = `${Math.round(((c - p) / p) * 100)}%`;
        return { city, orders: c, growth };
      });
      setAreaRows(areaTable);

      setWeekly(buckets.map((b) => ({ day: b.day, orders: b.orders, revenue: Math.round(b.revenue * 100) / 100 })));

      setLastLoadedAt(new Date());
      if (errs.length) setError(errs.slice(0, 2).join(' · '));
    } catch (e) {
      setError(e?.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const subtitleOrders = useMemo(() => pctVersusPrev(totalOrdersCurr, totalOrdersPrev), [totalOrdersCurr, totalOrdersPrev]);
  const subtitleRevenue = useMemo(() => pctVersusPrev(revenueCurr, revenuePrev), [revenueCurr, revenuePrev]);
  const subtitleAccounts = useMemo(() => pctVersusPrev(newAccountsCurr, newAccountsPrev), [newAccountsCurr, newAccountsPrev]);
  const subtitleCompletion = useMemo(() => formatRateDelta(completionCurr, completionPrev), [completionCurr, completionPrev]);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <p className="admDim" style={{ margin: 0, fontSize: '0.82rem' }}>
          Recent {PERIOD_DAYS}-day slice · {loading ? 'Loading…' : lastLoadedAt ? `Updated ${lastLoadedAt.toLocaleTimeString()}` : '—'}
        </p>
      </div>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Total orders</p>
          <p className="v">{loading ? '…' : totalOrdersCurr.toLocaleString()}</p>
          <p className="admDim">{loading ? '…' : subtitleOrders}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Revenue</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : formatGBP(revenueCurr)}
          </p>
          <p className="admDim">{loading ? '…' : subtitleRevenue}</p>
          <p className="admDim" style={{ fontSize: '0.75rem' }}>
            Non-cancelled booking amounts (current {PERIOD_DAYS} days)
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">New customer accounts</p>
          <p className="v">{loading ? '…' : newAccountsCurr.toLocaleString()}</p>
          <p className="admDim">{loading ? '…' : subtitleAccounts}</p>
          <p className="admDim" style={{ fontSize: '0.75rem' }}>
            Registered in period (not shop-only checkout)
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Completion rate</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : `${completionCurr}%`}
          </p>
          <p className="admDim">{loading ? '…' : subtitleCompletion}</p>
          <p className="admDim" style={{ fontSize: '0.75rem' }}>
            Delivered / completed vs all bookings in period
          </p>
        </article>
      </section>

      <section className="admGrid2" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard">
          <div className="admSectionHeader">
            <h3>Orders trend (last 7 days)</h3>
          </div>
          {loading ? <p className="admDim">Loading…</p> : <MiniBars weekly={weekly} />}
        </article>
        <article className="admCard">
          <div className="admSectionHeader">
            <h3>Service mix</h3>
            <span className="admDim" style={{ fontSize: '0.78rem' }}>
              Share of orders · current {PERIOD_DAYS} days
            </span>
          </div>
          {serviceMix.map((item) => (
            <div key={item.label} className="admMixRow">
              <div>
                <span className="admLegendDot" style={{ background: item.color }} /> {item.label}
              </div>
              <strong>{loading ? '…' : `${item.value}%`}</strong>
            </div>
          ))}
        </article>
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSectionHeader">
          <h3>Top pickup / address lines</h3>
          <span className="admDim" style={{ fontSize: '0.78rem' }}>
            First segment before comma · current {PERIOD_DAYS} days
          </span>
        </div>
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Origin (trimmed)</th>
                <th>Orders</th>
                <th>Growth</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="admDim">
                    Loading…
                  </td>
                </tr>
              ) : areaRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="admDim">
                    No address data in this period.
                  </td>
                </tr>
              ) : (
                areaRows.map((item) => (
                  <tr key={item.city}>
                    <td>{item.city}</td>
                    <td>{item.orders}</td>
                    <td
                      style={{
                        color: item.growth === '—' ? undefined : item.growth.startsWith('-') ? '#c62828' : '#0A58A6',
                      }}
                    >
                      {item.growth}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admCard">
        <div className="admSectionHeader">
          <h3>Revenue & orders snapshot</h3>
          <span className="admDim" style={{ fontSize: '0.78rem' }}>
            Last 7 calendar days
          </span>
        </div>
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Day</th>
                <th>Orders</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((item, idx) => (
                <tr key={`${item.day}-${idx}`}>
                  <td>{item.day}</td>
                  <td>{loading ? '…' : item.orders}</td>
                  <td style={{ color: '#0A58A6' }}>{loading ? '…' : formatGBP(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
