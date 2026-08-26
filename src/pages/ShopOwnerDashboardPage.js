import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { shopOwnerOrderStatusLabel } from '../lib/shopOrderStatus';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerDashboardPremium.css';

function displayStatus(raw) {
  return shopOwnerOrderStatusLabel(raw);
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function badgeClass(s) {
  if (s === 'Delivered') return 'sod-badge sod-badge--delivered';
  if (s === 'Cancelled') return 'sod-badge sod-badge--cancel';
  if (s === 'New order' || s === 'Preparing' || s === 'Pending' || s === 'Processing') {
    return 'sod-badge sod-badge--pending';
  }
  return 'sod-badge sod-badge--default';
}

function IcOrders() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 9.5h16" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IcPound() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M8 21h8M10 3v18M14 7.5a4 4 0 0 0-8 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IcClock() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8.5V12l2.2 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcDelivery() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M2 10h9v5H2V10ZM12 12h2.2l1.5 1.2 2.1.1H20v-2.5M6 16.2a1.1 1.1 0 0 0 0 .1M15 16.2a1.1 1.1 0 0 0 0 .1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IcProductEmpty() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden>
      <path
        d="M6 8h12l-1 10H7L6 8ZM9 8V6a3 3 0 0 1 6 0v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WeekChart({ week }) {
  const w = 300;
  const h = 130;
  const padL = 28;
  const padR = 12;
  const padT = 14;
  const padB = 22;
  const max = Math.max(...week.map((x) => x.v), 1);
  const min = 0;
  const coords = week.map((d, i) => {
    const x = padL + (i * (w - padL - padR)) / (week.length - 1);
    const y = padT + (1 - (d.v - min) / (max - min)) * (h - padT - padB);
    return { x, y, d: d.d, v: d.v };
  });
  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const baselineY = h - padB;
  const areaPath = `${linePath} L${coords[coords.length - 1].x},${baselineY} L${coords[0].x},${baselineY} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="sod-chart-svg"
      style={{ width: '100%', maxWidth: 440, height: 'auto', display: 'block' }}
      role="img"
      aria-label="Revenue this week"
    >
      {[0, 1, 2, 3].map((g) => {
        const y = padT + (g * (h - padT - padB)) / 3;
        return <line key={g} x1={padL} y1={y} x2={w - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
      })}
      <text x="6" y={padT + 4} fontSize="7" fill="#9ca3af" fontWeight="600">
        Â$
      </text>
      <path d={areaPath} fill="rgba(7, 64, 143, 0.08)" stroke="none" />
      <path d={linePath} fill="none" stroke="#07408F" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((p) => (
        <circle key={p.d} cx={p.x} cy={p.y} r="3.5" fill="#EC6C23" stroke="#fff" strokeWidth="1.5" />
      ))}
      {coords.map((p) => (
        <text key={`${p.d}-lbl`} x={p.x} y={h - 5} textAnchor="middle" fontSize="7" fill="#9ca3af" fontWeight="600">
          {p.d}
        </text>
      ))}
    </svg>
  );
}

export default function ShopOwnerDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [recent, setRecent] = useState([]);
  const [products, setProducts] = useState([]);
  const [todayOrders, setTodayOrders] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [activeDeliveries, setActiveDeliveries] = useState(0);
  const [week, setWeek] = useState([
    { d: 'Mon', v: 0 },
    { d: 'Tue', v: 0 },
    { d: 'Wed', v: 0 },
    { d: 'Thu', v: 0 },
    { d: 'Fri', v: 0 },
    { d: 'Sat', v: 0 },
    { d: 'Sun', v: 0 },
  ]);

  const loadDashboard = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    const session = getShopOwnerSession();
    if (!session?.id) {
      setLoadError('Sign in as a shop owner to view dashboard data.');
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
      setRecent([]);
      setProducts([]);
      setTodayOrders(0);
      setTodayRevenue(0);
      setPendingOrders(0);
      setActiveDeliveries(0);
      setWeek((prev) => prev.map((x) => ({ ...x, v: 0 })));
      setLoading(false);
      return;
    }

    const { data: orderRows, error: orderErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .in('id', orderIds);

    if (orderErr) {
      setLoadError(orderErr.message);
      setLoading(false);
      return;
    }

    const orderById = Object.fromEntries((orderRows || []).map((o) => [o.id, o]));
    const grouped = {};
    lines.forEach((line) => {
      const ord = orderById[line.order_id];
      if (!ord) return;
      if (!grouped[line.order_id]) grouped[line.order_id] = { order: ord, lines: [] };
      grouped[line.order_id].lines.push(line);
    });

    const entries = Object.values(grouped).sort(
      (a, b) => new Date(b.order.placed_at).getTime() - new Date(a.order.placed_at).getTime(),
    );

    const now = new Date();
    const recentRows = entries.slice(0, 8).map((x) => {
      const amountNum = x.lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      const itemCount = x.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
      return {
        id: x.order.order_number || x.order.id,
        customer: x.order.customer_full_name || 'Customer',
        items: String(itemCount),
        amount: formatGBP(amountNum),
        status: displayStatus(x.order.status),
      };
    });
    setRecent(recentRows);

    let todayOrderCount = 0;
    let todayRev = 0;
    let pendingCount = 0;
    let activeCount = 0;
    entries.forEach((x) => {
      const placed = new Date(x.order.placed_at);
      const status = displayStatus(x.order.status);
      const orderTotal = x.lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      if (isSameDay(placed, now)) {
        todayOrderCount += 1;
        todayRev += orderTotal;
      }
      if (status === 'New order' || status === 'Preparing') pendingCount += 1;
      if (status === 'In transit') activeCount += 1;
    });
    setTodayOrders(todayOrderCount);
    setTodayRevenue(todayRev);
    setPendingOrders(pendingCount);
    setActiveDeliveries(activeCount);

    const productAgg = {};
    lines.forEach((line) => {
      const name = line.product_name || 'Product';
      if (!productAgg[name]) productAgg[name] = { name, units: 0, revNum: 0 };
      productAgg[name].units += Number(line.quantity) || 0;
      productAgg[name].revNum += Number(line.line_total) || 0;
    });
    setProducts(
      Object.values(productAgg)
        .sort((a, b) => b.units - a.units)
        .slice(0, 5)
        .map((p) => ({ ...p, rev: formatGBP(p.revNum), units: String(p.units) })),
    );

    const dayKeys = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(now.getDate() - i);
      dayKeys.push({ key: d.toDateString(), d: d.toLocaleDateString([], { weekday: 'short' }), v: 0 });
    }
    lines.forEach((line) => {
      const ord = orderById[line.order_id];
      if (!ord?.placed_at) return;
      const key = new Date(ord.placed_at).toDateString();
      const day = dayKeys.find((x) => x.key === key);
      if (day) day.v += Number(line.line_total) || 0;
    });
    setWeek(dayKeys.map((x) => ({ d: x.d, v: Number(x.v.toFixed(2)) })));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const weekGrowthText = useMemo(() => {
    if (week.length < 2) return 'No trend data yet';
    const prev = week.slice(0, -1).reduce((s, x) => s + x.v, 0);
    const last = week[week.length - 1].v;
    if (prev <= 0) return 'No trend data yet';
    const pct = ((last - prev / (week.length - 1)) / (prev / (week.length - 1))) * 100;
    const dir = pct >= 0 ? '+' : '';
    return `${dir}${pct.toFixed(0)}% vs avg day`;
  }, [week]);

  return (
    <div className="sod-dash">
      <div className="sod-welcome">
        <h2>Good Morning ??</h2>
        <p>Here&apos;s your shop overview today</p>
      </div>

      <div className="sod-body">
        {loadError ? (
          <div className="sod-error" role="alert">
            <p>{loadError}</p>
          </div>
        ) : null}

        <div className="sod-stats" aria-label="Key metrics">
          <article className="sod-stat">
            <span className="sod-stat-icon sod-stat-icon--blue" aria-hidden>
              <IcOrders />
            </span>
            <p className="sod-stat-label">Total orders today</p>
            <p className="sod-stat-value">{todayOrders}</p>
            <p className="sod-stat-foot">{loading ? 'Loading�' : 'From today only'}</p>
          </article>
          <article className="sod-stat">
            <span className="sod-stat-icon sod-stat-icon--green" aria-hidden>
              <IcPound />
            </span>
            <p className="sod-stat-label">Today&apos;s revenue</p>
            <p className="sod-stat-value sod-stat-value--blue">{formatGBP(todayRevenue)}</p>
            <p className="sod-stat-foot">{loading ? 'Loading�' : weekGrowthText}</p>
          </article>
          <article className="sod-stat">
            <span className="sod-stat-icon sod-stat-icon--orange" aria-hidden>
              <IcClock />
            </span>
            <p className="sod-stat-label">Orders needing action</p>
            <p className="sod-stat-value sod-stat-value--orange">{pendingOrders}</p>
            <p className="sod-stat-foot sod-stat-foot--orange">Needs attention</p>
          </article>
          <article className="sod-stat">
            <span className="sod-stat-icon sod-stat-icon--purple" aria-hidden>
              <IcDelivery />
            </span>
            <p className="sod-stat-label">Active deliveries</p>
            <p className="sod-stat-value">{activeDeliveries}</p>
            <p className="sod-stat-foot">In transit now</p>
          </article>
        </div>

        <section className="sod-chart-card" aria-labelledby="sod-rev-title">
          <div className="sod-chart-head">
            <h3 id="sod-rev-title">Revenue This Week</h3>
            <span className="sod-period-pill">This Week</span>
          </div>
          <WeekChart week={week} />
        </section>

        <section className="sod-best-card" aria-labelledby="sod-best-title">
          <h3 id="sod-best-title">Best Selling Today</h3>
          {loading ? (
            <p className="sod-best-empty">
              <span>Loading products�</span>
            </p>
          ) : products.length === 0 ? (
            <div className="sod-best-empty">
              <IcProductEmpty />
              <p>No product sales data yet.</p>
            </div>
          ) : (
            <ul className="sod-best-list">
              {products.map((p) => (
                <li key={p.name}>
                  <span>
                    <div className="sod-best-name">{p.name}</div>
                    <div className="sod-best-units">{p.units} units</div>
                  </span>
                  <span className="sod-best-rev">{p.rev}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="sod-sec-head">
          <h2>Recent Orders</h2>
          <Link to="/shop-owner/orders" className="sod-view-all">
            View all
          </Link>
        </div>
        <div className="sod-table-wrap">
          <table className="sod-table" aria-label="Recent orders">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="sod-table-empty">
                    Loading recent orders�
                  </td>
                </tr>
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="sod-table-empty">
                    No orders yet. Orders appear here when customers buy your products.
                  </td>
                </tr>
              ) : (
                recent.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.customer}</td>
                    <td>{r.items}</td>
                    <td>{r.amount}</td>
                    <td>
                      <span className={badgeClass(r.status)}>{r.status}</span>
                    </td>
                    <td>
                      <Link to="/shop-owner/orders" className="sod-action-btn">
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
