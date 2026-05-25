import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatGBP } from '../lib/currency';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerAnalyticsPremium.css';

const PERIODS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
];

const COLORS = {
  orange: '#EC6C23',
  blue: '#07408F',
  green: '#16a34a',
  red: '#dc2626',
  grey: '#d1d5db',
  grid: '#f0f2f5',
  axis: '#9ca3af',
};

function statusLabel(raw) {
  const s = String(raw || 'placed').toLowerCase().replace(/_/g, ' ');
  if (s === 'placed') return 'pending';
  if (s === 'processing') return 'processing';
  if (s === 'ready for delivery') return 'processing';
  if (s === 'picked up') return 'processing';
  if (s === 'in transit') return 'in transit';
  if (s === 'delivered') return 'delivered';
  if (s === 'cancelled') return 'cancelled';
  return s;
}

function MiniLine({ d, w = 48, h = 20 }) {
  return (
    <svg className="soan-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={`M${d}`} fill="none" stroke={COLORS.orange} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniDonut({ pct }) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  const c = 2 * Math.PI * 10;
  const dash = (safe / 100) * c;
  return (
    <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden>
      <circle cx="16" cy="16" r="10" fill="none" stroke="#e5e7eb" strokeWidth="4" />
      <circle
        cx="16"
        cy="16"
        r="10"
        fill="none"
        stroke={COLORS.orange}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}

function MiniBars({ bars, placeholder }) {
  const h = Array.isArray(bars) && bars.length ? bars : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...h, 1);
  const isEmpty = !h.some((v) => v > 0);
  return (
    <svg className="soan-spark" viewBox="0 0 40 20" width="80" height="24" preserveAspectRatio="none" aria-hidden>
      {h.map((v, i) => {
        const barH = isEmpty || placeholder ? 4 : (v / max) * 14 + 2;
        const fill = isEmpty || placeholder ? COLORS.grey : COLORS.blue;
        return (
          <rect key={i} x={i * 5.2 + 0.5} y={20 - barH} width="4" height={barH} fill={fill} rx="1" />
        );
      })}
    </svg>
  );
}

function RevLine({ data, w = 400, h = 120, setTip }) {
  const pad = 28;
  const maxR = Math.max(...data.map((d) => d.rev), 1);
  const coords = data.map((d, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(data.length - 1, 1);
    const y = pad + (1 - d.rev / maxR) * (h - 2 * pad);
    return { x, y, d };
  });
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1].x},${h - pad} L${coords[0].x},${h - pad} Z`
      : '';

  return (
    <div className="soan-chart-wrap">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        onMouseLeave={() => setTip(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = (e.clientX - r.left) / r.width;
          const i = Math.round(t * (data.length - 1));
          const idx = Math.max(0, Math.min(data.length - 1, i));
          const c = data[idx];
          setTip({ x: e.clientX, y: e.clientY, v: c.rev, l: c.d });
        }}
        role="img"
        aria-label="Revenue trend"
      >
        <defs>
          <linearGradient id="soanRevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(236,108,35,0.18)" />
            <stop offset="100%" stopColor="rgba(236,108,35,0.02)" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((g) => {
          const yy = pad + (g * (h - 2 * pad)) / 3;
          return <line key={g} x1={pad} y1={yy} x2={w - pad} y2={yy} stroke={COLORS.grid} strokeWidth="0.5" />;
        })}
        {areaPath ? <path d={areaPath} fill="url(#soanRevGrad)" /> : null}
        <path d={linePath} fill="none" stroke={COLORS.orange} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c) => (
          <circle key={c.d.d} cx={c.x} cy={c.y} r="2.5" fill={COLORS.orange} />
        ))}
        {coords.map((c, i) =>
          i % Math.max(1, Math.floor(data.length / 7)) === 0 || i === data.length - 1 ? (
            <text key={`lbl-${c.d.d}`} x={c.x} y={h - 8} textAnchor="middle" fontSize="6" fill={COLORS.axis}>
              {c.d.d.split(' ')[0]}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

function StackedBars({ data, w = 400, h = 120 }) {
  const pad = 24;
  const barW = Math.max(4, (w - 2 * pad) / data.length - 4);
  return (
    <div className="soan-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Orders by status">
        {data.map((d, i) => {
          const x = pad + (i * (w - 2 * pad)) / data.length + 2;
          const t = d.del + d.tr + d.can;
          const h1 = t ? (d.del / t) * (h - 2 * pad) : 0;
          const h2 = t ? (d.tr / t) * (h - 2 * pad) : 0;
          const h3 = t ? (d.can / t) * (h - 2 * pad) : 0;
          const y0 = h - pad;
          return (
            <g key={d.d}>
              <rect x={x} y={y0 - h1 - h2 - h3} width={barW} height={h3} fill={COLORS.red} rx="1" />
              <rect x={x} y={y0 - h1 - h2} width={barW} height={h2} fill={COLORS.blue} rx="1" />
              <rect x={x} y={y0 - h1} width={barW} height={h1} fill={COLORS.green} rx="1" />
              <text x={x + barW / 2} y={h - 6} textAnchor="middle" fontSize="5" fill={COLORS.axis}>
                {d.d.split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function IcProductsEmpty() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden style={{ color: '#d1d5db' }}>
      <rect x="10" y="16" width="44" height="36" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M10 24h44M22 16V12h20v4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M22 34h20M22 42h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function ShopOwnerAnalyticsPage() {
  const [per, setPer] = useState('7');
  const [tip, setTip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [allPoints, setAllPoints] = useState([]);
  const [allOrdersCount, setAllOrdersCount] = useState(0);
  const [topProducts, setTopProducts] = useState([]);
  const [aov, setAov] = useState(0);
  const [completionRate, setCompletionRate] = useState(0);
  const [activeDay, setActiveDay] = useState('—');
  const [returnRate, setReturnRate] = useState(0);
  const [onTimePct, setOnTimePct] = useState(0);
  const [inTransitPct, setInTransitPct] = useState(0);
  const [cancelPct, setCancelPct] = useState(0);
  const [uniqueCustomers, setUniqueCustomers] = useState(0);
  const [returningCustomers, setReturningCustomers] = useState(0);
  const [topLocations, setTopLocations] = useState([]);

  const loadAnalytics = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    const session = getShopOwnerSession();
    if (!session?.id) {
      setLoadError('Sign in as a shop owner to view analytics.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setLoadError('Supabase is not configured.');
      setLoading(false);
      return;
    }

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
    if (!orderIds.length) {
      setAllPoints([]);
      setTopProducts([]);
      setAllOrdersCount(0);
      setAov(0);
      setCompletionRate(0);
      setActiveDay('—');
      setReturnRate(0);
      setOnTimePct(0);
      setInTransitPct(0);
      setCancelPct(0);
      setUniqueCustomers(0);
      setReturningCustomers(0);
      setTopLocations([]);
      setLoading(false);
      return;
    }

    const { data: orders, error: orderErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .in('id', orderIds);
    if (orderErr) {
      setLoadError(orderErr.message);
      setLoading(false);
      return;
    }

    const { data: products } = await supabase
      .from('shop_products')
      .select('id, name, stock')
      .eq('shop_owner_id', session.id);
    const stockByName = Object.fromEntries((products || []).map((p) => [String(p.name || '').trim(), Number(p.stock) || 0]));

    const orderMap = Object.fromEntries((orders || []).map((o) => [o.id, o]));
    const grouped = {};
    lines.forEach((line) => {
      const ord = orderMap[line.order_id];
      if (!ord) return;
      if (!grouped[line.order_id]) grouped[line.order_id] = { order: ord, lines: [] };
      grouped[line.order_id].lines.push(line);
    });
    const entries = Object.values(grouped).sort(
      (a, b) => new Date(a.order.placed_at).getTime() - new Date(b.order.placed_at).getTime(),
    );

    const now = new Date();
    const points = [];
    for (let i = 89; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      points.push({
        key: d.toDateString(),
        d: d.toLocaleDateString([], { weekday: 'short', day: '2-digit' }),
        rev: 0,
        del: 0,
        tr: 0,
        can: 0,
      });
    }
    const pointByKey = Object.fromEntries(points.map((p) => [p.key, p]));

    let totalRevenue = 0;
    let delivered = 0;
    let inTransit = 0;
    let cancelled = 0;
    const productAgg = {};
    const customerCount = {};
    const locationCount = {};

    entries.forEach((entry) => {
      const total = entry.lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      totalRevenue += total;
      const s = statusLabel(entry.order.status);
      if (s === 'delivered') delivered += 1;
      if (s === 'in transit') inTransit += 1;
      if (s === 'cancelled') cancelled += 1;

      const key = new Date(entry.order.placed_at).toDateString();
      const p = pointByKey[key];
      if (p) {
        p.rev += total;
        if (s === 'delivered') p.del += 1;
        else if (s === 'in transit') p.tr += 1;
        else if (s === 'cancelled') p.can += 1;
      }

      const custKey = String(entry.order.customer_phone || entry.order.customer_email || entry.order.customer_full_name || '').trim();
      if (custKey) customerCount[custKey] = (customerCount[custKey] || 0) + 1;

      const rawAddr = String(entry.order.customer_address || '').trim();
      const area = rawAddr.split(',')[0]?.trim();
      if (area) locationCount[area] = (locationCount[area] || 0) + 1;

      entry.lines.forEach((l) => {
        const name = String(l.product_name || 'Product').trim();
        if (!productAgg[name]) productAgg[name] = { name, u: 0, r: 0 };
        productAgg[name].u += Number(l.quantity) || 0;
        productAgg[name].r += Number(l.line_total) || 0;
      });
    });

    const totalOrders = entries.length;
    const completed = delivered;
    const completion = totalOrders ? (completed / totalOrders) * 100 : 0;
    const aovNum = totalOrders ? totalRevenue / totalOrders : 0;
    const activePoint = [...points].sort((a, b) => (b.del + b.tr + b.can) - (a.del + a.tr + a.can))[0];
    const unique = Object.keys(customerCount).length;
    const returning = Object.values(customerCount).filter((n) => n > 1).length;
    const returnPct = unique ? (returning / unique) * 100 : 0;

    setAllPoints(points);
    setAllOrdersCount(totalOrders);
    setAov(aovNum);
    setCompletionRate(completion);
    setActiveDay(activePoint ? activePoint.d.split(' ')[0] : '—');
    setReturnRate(returnPct);
    setOnTimePct(completion);
    setInTransitPct(totalOrders ? (inTransit / totalOrders) * 100 : 0);
    setCancelPct(totalOrders ? (cancelled / totalOrders) * 100 : 0);
    setUniqueCustomers(unique);
    setReturningCustomers(returning);
    setTopLocations(
      Object.entries(locationCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name),
    );
    setTopProducts(
      Object.values(productAgg)
        .sort((a, b) => b.r - a.r)
        .slice(0, 8)
        .map((p) => ({ ...p, s: stockByName[p.name] ?? 0 })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const ddata = useMemo(() => {
    const days = Number(per) || 7;
    const sliced = allPoints.slice(-days);
    return sliced.length ? sliced : [];
  }, [allPoints, per]);
  const currentRev = useMemo(() => ddata.reduce((s, x) => s + x.rev, 0), [ddata]);
  const previousRev = useMemo(() => {
    const days = Number(per) || 7;
    if (allPoints.length < days * 2) return 0;
    return allPoints.slice(-(days * 2), -days).reduce((s, x) => s + x.rev, 0);
  }, [allPoints, per]);
  const chg = useMemo(() => {
    if (previousRev <= 0) return 0;
    return ((currentRev - previousRev) / previousRev) * 100;
  }, [currentRev, previousRev]);
  const miniBars = useMemo(() => ddata.slice(-7).map((x) => x.del + x.tr + x.can), [ddata]);
  const chartFallback = [{ d: '—', rev: 0, del: 0, tr: 0, can: 0 }];
  const chartData = ddata.length ? ddata : chartFallback;
  const showProductsEmpty = !loading && topProducts.length === 0;
  const hasNoOrderActivity = miniBars.every((v) => v === 0);

  return (
    <div className="soan-page">
      <header className="soan-head">
        <h1>Analytics</h1>
        <div className="soan-periods" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={per === p.id ? 'soan-period soan-period--on' : 'soan-period'}
              onClick={() => setPer(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {loadError ? (
        <div className="soan-error" role="alert">
          <p>{loadError}</p>
        </div>
      ) : null}

      <section className="soan-card" style={{ position: 'relative' }} aria-labelledby="soan-rev-title">
        <h2 id="soan-rev-title" className="soan-card-title">
          Revenue Overview
        </h2>
        <p className="soan-big-value">{formatGBP(currentRev)}</p>
        <span className={`soan-chg-pill ${chg >= 0 ? 'soan-chg-pill--up' : 'soan-chg-pill--down'}`}>
          {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(1)}% vs previous period
        </span>
        <RevLine data={chartData} setTip={setTip} />
        {tip ? (
          <div className="soan-tooltip" style={{ left: tip.x + 10, top: tip.y - 40 }}>
            {tip.l} · {formatGBP(tip.v)} revenue
          </div>
        ) : null}
        <p className="soan-footnote">{loading ? 'Loading analytics…' : `Based on your last ${per} days.`}</p>
      </section>

      <section className="soan-card" aria-labelledby="soan-ord-title">
        <h2 id="soan-ord-title" className="soan-card-title">
          Orders Overview
        </h2>
        <p className="soan-card-sub">Stacked: delivered · in transit · cancelled</p>
        <StackedBars data={chartData} />
        <div className="soan-legend" aria-hidden>
          <span className="soan-legend-item">
            <span className="soan-legend-dot soan-legend-dot--del" />
            Delivered
          </span>
          <span className="soan-legend-item">
            <span className="soan-legend-dot soan-legend-dot--tr" />
            In transit
          </span>
          <span className="soan-legend-item">
            <span className="soan-legend-dot soan-legend-dot--can" />
            Cancelled
          </span>
        </div>
      </section>

      <div className="soan-stats-grid">
        <article className="soan-stat-card">
          <p className="soan-stat-label">Average order value</p>
          <p className="soan-stat-value">{formatGBP(aov)}</p>
          <div className="soan-stat-mini">
            <MiniLine d="0,14 10,6 20,8 30,2 40,0 48,4" />
          </div>
        </article>
        <article className="soan-stat-card">
          <p className="soan-stat-label">Order completion rate</p>
          <p className="soan-stat-value">{completionRate.toFixed(0)}%</p>
          <div className="soan-stat-mini">
            <MiniDonut pct={completionRate} />
          </div>
        </article>
        <article className="soan-stat-card">
          <p className="soan-stat-label">Most active day</p>
          <p className="soan-stat-value" style={{ fontSize: '1.35rem', color: '#1f2937' }}>
            {activeDay}
          </p>
          <div className="soan-stat-mini">
            <MiniBars bars={miniBars} placeholder={hasNoOrderActivity} />
          </div>
        </article>
        <article className="soan-stat-card">
          <p className="soan-stat-label">Customer return rate</p>
          <p className="soan-stat-value">{returnRate.toFixed(0)}%</p>
          <div className="soan-stat-mini">
            <MiniLine d="0,16 12,0 24,4 40,0 48,3" w={48} h={20} />
          </div>
        </article>
      </div>

      <section className="soan-products-card" aria-labelledby="soan-prod-title">
        <h2 id="soan-prod-title" className="soan-card-title">
          Best Performing Products
        </h2>
        {showProductsEmpty ? (
          <div className="soan-table-empty-wrap" role="status">
            <IcProductsEmpty />
            <p>No product sales yet.</p>
          </div>
        ) : (
          <div className="soan-table-scroll">
            <table className="soan-table" aria-label="Top products">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>Revenue</th>
                  <th>Stock Left</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="soan-table-loading">
                      Loading products…
                    </td>
                  </tr>
                ) : (
                  topProducts.map((p) => (
                    <tr key={p.name}>
                      <td className="soan-td-name">{p.name}</td>
                      <td>{p.u}</td>
                      <td className="soan-td-rev">{formatGBP(p.r)}</td>
                      <td>{p.s}</td>
                      <td>—</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="soan-card" aria-labelledby="soan-del-title">
        <h2 id="soan-del-title" className="soan-card-title">
          Delivery Stats
        </h2>
        <p className="soan-tracked">
          Total tracked orders: <strong>{allOrdersCount}</strong>
        </p>
        <div className="soan-dbar-list">
          <div className="soan-dbar-row">
            <span className="soan-dbar-label">On time</span>
            <div className="soan-dbar-track">
              <div className="soan-dbar-fill soan-dbar-fill--on" style={{ width: `${onTimePct.toFixed(1)}%` }} />
            </div>
            <span className="soan-dbar-pct">{onTimePct.toFixed(0)}%</span>
          </div>
          <div className="soan-dbar-row">
            <span className="soan-dbar-label">Late</span>
            <div className="soan-dbar-track">
              <div className="soan-dbar-fill soan-dbar-fill--late" style={{ width: `${inTransitPct.toFixed(1)}%` }} />
            </div>
            <span className="soan-dbar-pct">{inTransitPct.toFixed(0)}%</span>
          </div>
          <div className="soan-dbar-row">
            <span className="soan-dbar-label">Cancelled</span>
            <div className="soan-dbar-track">
              <div className="soan-dbar-fill soan-dbar-fill--can" style={{ width: `${cancelPct.toFixed(1)}%` }} />
            </div>
            <span className="soan-dbar-pct">{cancelPct.toFixed(0)}%</span>
          </div>
        </div>
        <div className="soan-hstack" role="img" aria-label="Combined order outcomes">
          <div className="soan-hstack-seg soan-hstack-seg--on" style={{ flex: Math.max(onTimePct, 0.1) }} title="On time" />
          <div className="soan-hstack-seg soan-hstack-seg--late" style={{ flex: Math.max(inTransitPct, 0.1) }} title="Late" />
          <div className="soan-hstack-seg soan-hstack-seg--can" style={{ flex: Math.max(cancelPct, 0.1) }} title="Cancelled" />
        </div>
      </section>

      <section className="soan-card" aria-labelledby="soan-cust-title">
        <h2 id="soan-cust-title" className="soan-card-title">
          Customer Insights
        </h2>
        <p className="soan-insights-line">
          New customers this period: <strong>{Math.max(uniqueCustomers - returningCustomers, 0)}</strong> · Returning:{' '}
          <strong>{returningCustomers}</strong>
        </p>
        <p className="soan-locations-title">Top delivery locations</p>
        {topLocations.length ? (
          <div className="soan-locations">
            {topLocations.map((L) => (
              <span key={L} className="soan-loc-pill">
                {L}
              </span>
            ))}
          </div>
        ) : (
          <p className="soan-loc-empty">No location data</p>
        )}
      </section>
    </div>
  );
}
