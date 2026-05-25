import { useEffect, useMemo, useState } from 'react';
import { fetchCompletedDeliveriesForDriver } from '../lib/driverIncomingBookings';
import { formatGBP } from '../lib/currency';
import { fetchPlatformCommissionSettings } from '../lib/platformCommissionSettings';
import { getDriverSession } from '../lib/driverSession';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './driverEarningsWalletProfile.css';
import './driverEarningsPremium.css';

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
];

function periodStart(period) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return startToday;
  if (period === 'week') {
    const s = new Date(startToday);
    s.setDate(s.getDate() - 6);
    return s;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function inPeriod(iso, period) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (t > Date.now()) return false;
  return t >= periodStart(period).getTime();
}

/** Human-friendly percent for labels (e.g. 12.5 → "12.5", 10 → "10"). */
function formatPctDisplay(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return String(r);
}

function jobNet(amount, commissionPct) {
  const gross = Number(amount) || 0;
  const p = Number(commissionPct);
  if (!Number.isFinite(p) || p <= 0) return gross;
  return Math.round(gross * (1 - p / 100) * 100) / 100;
}

function formatRecentTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startToday) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yday = new Date(startToday);
  yday.setDate(yday.getDate() - 1);
  if (d >= yday && d < startToday) return 'Yesterday';
  return d.toLocaleDateString(undefined, { dateStyle: 'short' });
}

/** @param {{ at: string, amount: number }[]} rows */
function buildChart(period, rows) {
  if (period === 'today') {
    const labels = ['12a', '4a', '8a', '12p', '4p', '8p'];
    const bounds = [0, 4, 8, 12, 16, 20];
    return labels.map((day, i) => {
      const lo = bounds[i];
      const hi = i === labels.length - 1 ? 24 : bounds[i + 1];
      const sum = rows.reduce((s, r) => {
        const h = new Date(r.at).getHours();
        if (h >= lo && h < hi) return s + r.amount;
        return s;
      }, 0);
      return { day, amount: Math.round(sum * 100) / 100 };
    });
  }
  if (period === 'week') {
    const start = periodStart('week');
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const keyY = d.getFullYear();
      const keyM = d.getMonth();
      const keyD = d.getDate();
      const sum = rows.reduce((s, r) => {
        const x = new Date(r.at);
        if (x.getFullYear() === keyY && x.getMonth() === keyM && x.getDate() === keyD) return s + r.amount;
        return s;
      }, 0);
      return {
        day: d.toLocaleDateString(undefined, { weekday: 'short' }),
        amount: Math.round(sum * 100) / 100,
      };
    });
  }
  const now = new Date();
  const lastDay = now.getDate();
  const span = Math.max(1, lastDay);
  const chunk = Math.ceil(span / 7);
  return Array.from({ length: 7 }, (_, i) => {
    const fromD = i * chunk + 1;
    const toD = Math.min(lastDay, (i + 1) * chunk);
    const sum = rows.reduce((s, r) => {
      const x = new Date(r.at);
      if (x.getFullYear() !== now.getFullYear() || x.getMonth() !== now.getMonth()) return s;
      const dom = x.getDate();
      if (dom >= fromD && dom <= toD) return s + r.amount;
      return s;
    }, 0);
    return {
      day: fromD === toD ? String(fromD) : `${fromD}–${toD}`,
      amount: Math.round(sum * 100) / 100,
    };
  });
}

function IcCal() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="16" rx="1.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v3M16 2.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IcJobsEmpty() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ margin: '0 auto 0.75rem', display: 'block', color: '#9ca3af' }}
    >
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function DriverEarningsPage() {
  const [period, setPeriod] = useState('week');
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [driverCommissionPct, setDriverCommissionPct] = useState(0);

  const driverId = getDriverSession()?.id || null;

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured || !supabase) return undefined;
    (async () => {
      const { data } = await fetchPlatformCommissionSettings(supabase);
      if (cancelled || !data) return;
      const p = Number(data.driver_commission_percent);
      setDriverCommissionPct(Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!driverId || !isSupabaseConfigured || !supabase) {
      setAllRows([]);
      setLoading(false);
      setLoadErr(
        !driverId ? '' : !isSupabaseConfigured || !supabase ? 'Connect Supabase to load completed jobs.' : '',
      );
      return undefined;
    }
    setLoading(true);
    setLoadErr('');
    (async () => {
      const rows = await fetchCompletedDeliveriesForDriver(supabase, driverId);
      if (!cancelled) {
        setAllRows(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  const filtered = useMemo(() => allRows.filter((r) => inPeriod(r.at, period)), [allRows, period]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const n = filtered.length;
    const avg = n > 0 ? total / n : 0;
    const sublabel = PERIODS.find((p) => p.id === period)?.label || 'This Week';
    const pct = Number(driverCommissionPct);
    const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
    const commission = Math.round(total * (safePct / 100) * 100) / 100;
    const net = Math.round((total - commission) * 100) / 100;
    const avgNet = n > 0 ? net / n : 0;
    return {
      sublabel,
      pctDisplay: formatPctDisplay(safePct),
      totalStr: formatGBP(total),
      deliveries: String(n),
      hours: `${formatPctDisplay(safePct)}%`,
      avgStr: n > 0 ? formatGBP(avg) : formatGBP(0),
      avgNetStr: n > 0 ? formatGBP(avgNet) : formatGBP(0),
      grossStr: formatGBP(total),
      commissionStr: formatGBP(-commission),
      netStr: formatGBP(net),
    };
  }, [filtered, period, driverCommissionPct]);

  const chart = useMemo(() => buildChart(period, filtered), [period, filtered]);

  const bars = useMemo(() => {
    const vals = chart.map((c) => c.amount);
    const m = Math.max(...vals, 0.01);
    return chart.map((c) => ({
      ...c,
      pct: c.amount <= 0 ? 0 : Math.max(9, (c.amount / m) * 100),
    }));
  }, [chart]);

  const recent = useMemo(() => allRows.slice(0, 25), [allRows]);

  return (
    <div className="dvRoot dvRoot--premium" role="main">
      <header className="dvH">
        <span className="dv__heroSpacer" aria-hidden />
        <h1>My Earnings</h1>
        <button type="button" className="dvFil" aria-label="Filter by date" onClick={() => {}}>
          <IcCal />
        </button>
      </header>
      <div className="dvSc">
        {loadErr ? <p className="dv__notice dv__notice--error">{loadErr}</p> : null}
        {loading ? <p className="dv__notice">Loading completed jobs…</p> : null}
        {!loading && !driverId ? (
          <p className="dv__notice">Sign in as a driver to see earnings from completed deliveries and rides.</p>
        ) : null}

        <section className="dvSum" aria-label="Earnings summary">
          <p className="dvSumL">
            Gross Earnings · {summary.sublabel}
          </p>
          <p className="dvSumAmt">{summary.totalStr}</p>
          <p className="dvSumNet" role="status">
            {summary.pctDisplay}% platform fee · You keep <span>{summary.netStr}</span>
          </p>
          <div className="dv3r">
            <div className="dv3b">
              <b>{summary.deliveries}</b>
              <span>Completed</span>
            </div>
            <div className="dv3b">
              <b>{summary.hours}</b>
              <span>Platform fee</span>
            </div>
            <div className="dv3b">
              <b>{summary.avgNetStr}</b>
              <span>Avg net / job</span>
            </div>
          </div>
        </section>

        <div className="dvTabs" role="tablist" aria-label="Earnings period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={period === p.id ? 'dvTab dvTab--on' : 'dvTab'}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <section className="dvCh" aria-label="Daily earnings chart">
          <h2 className="dvChT">Earnings</h2>
          <p className="dvChNote">
            Bars show gross job totals for the period. Net pay uses your {summary.pctDisplay}% platform fee on those totals.
          </p>
          <div className="dvBars">
            {bars.map((b, i) => (
              <div className="dvBcol" key={`${b.day}-${i}`}>
                <div className="dvBtrack">
                  <div
                    className={b.amount <= 0 ? 'dvBbar dvBbar--empty' : 'dvBbar'}
                    style={b.amount <= 0 ? { height: '4px' } : { height: `${b.pct}%` }}
                  >
                    {b.amount > 0 ? <span className="dvBval">{formatGBP(b.amount)}</span> : null}
                  </div>
                </div>
                <div className="dvBday">{b.day || '·'}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="dvBD" aria-label="Earnings breakdown">
          <div className="dvBDL">
            <span>Gross Earnings</span>
            <span className="dvBDR dvBDR--b">{summary.grossStr}</span>
          </div>
          <div className="dvBDL dvBDL--commission">
            <span>Platform Commission ({summary.pctDisplay}% of gross)</span>
            <span className="dvBDR dvBDR--r">{summary.commissionStr}</span>
          </div>
          <div className="dvBDL dvBDL--net">
            <span>Net Earnings</span>
            <span className="dvBDR dvBDR--net">{summary.netStr}</span>
          </div>
        </section>

        <h2 className="dvRsec">Completed Jobs</h2>
        {!loading && recent.length === 0 && driverId ? (
          <div className="dvJobsEmpty">
            <IcJobsEmpty />
            <p>
              No completed jobs yet. When you accept and finish a delivery or ride, it will appear here.
            </p>
          </div>
        ) : null}
        {recent.length > 0 ? (
          <div className="dvJobsCard">
            {recent.map((r) => (
              <div className="dvRrow" key={`${r.kind}-${r.id}`}>
                <div>
                  <p className="dvRid">
                    #{r.ref}{' '}
                    <span className="dvRkind">
                      (
                      {r.kind === 'parcel'
                        ? 'Parcel'
                        : r.kind === 'shop'
                          ? 'Shop'
                          : r.kind === 'tuktuk'
                            ? 'Tuk-Tuk'
                            : 'Taxi'}
                      )
                    </span>
                  </p>
                  <p className="dvRto">{r.to}</p>
                </div>
                <div className="dvRrowMeta">
                  <span className="dvRsub">{formatRecentTime(r.at)}</span>
                  <span className="dvRAmt">{formatGBP(r.amount)} gross</span>
                  <span className="dvRnet">
                    Net {formatGBP(jobNet(r.amount, driverCommissionPct))}
                    {driverCommissionPct > 0 ? ` (${formatPctDisplay(driverCommissionPct)}% fee)` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
