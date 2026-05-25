import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderOutlineBtn, AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import {
  ADMIN_REPORT_PERIOD_DAYS,
  downloadAdminReportsBundlePdf,
  fetchAdminReportPayload,
} from '../lib/adminReportsBundle';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const categories = [
  { key: 'revenue', title: 'Revenue report', color: 'green', icon: '📊', description: 'Booking value vs prior window, breakdown by delivery, taxi, tuk & shop.', anchor: 'adm-report-revenue' },
  { key: 'orders', title: 'Orders report', color: 'blue', icon: '📦', description: 'Placements, completion-style outcomes and cancellations.', anchor: 'adm-report-orders' },
  { key: 'drivers', title: 'Driver performance', color: 'purple', icon: '🚚', description: 'Approved / pending onboarding plus withdrawal queues.', anchor: 'adm-report-drivers' },
  { key: 'customers', title: 'Customer insight', color: 'orange', icon: '👥', description: 'Registered profiles and new sign-ups per window.', anchor: 'adm-report-customers' },
  { key: 'reviews', title: 'Reviews report', color: 'red', icon: '⭐', description: 'Trip review volumes and averages from trip_reviews.', anchor: 'adm-report-reviews' },
  { key: 'payouts', title: 'Payout report', color: 'green', icon: '💵', description: 'Withdrawals requested during the recent window.', anchor: 'adm-report-payouts' },
];

function pct(prev, curr) {
  if (prev <= 0 && curr > 0) return 'New vs prior window';
  if (prev <= 0) return '—';
  const p = Math.round(((curr - prev) / prev) * 100);
  if (p > 0) return `+${p}%`;
  if (p < 0) return `${p}%`;
  return '0%';
}

export default function AdminReportsPage() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState(null);
  const [pdfWorking, setPdfWorking] = useState(false);

  /** @type {null | string} */
  const [loadErr, setLoadErr] = useState(null);

  const scrollToAnchor = useCallback((id) => {
    const node = typeof document !== 'undefined' ? document.getElementById(id) : null;
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const load = useCallback(async () => {
    setLoadErr(null);
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setPayload(null);
      setLoadErr('Database is not configured.');
      return;
    }
    setLoading(true);
    const res = await fetchAdminReportPayload(supabase);
    setLoading(false);
    if (!res.ok) {
      setPayload(null);
      setLoadErr(res.errorMessage || 'Failed to load.');
      return;
    }
    setPayload(res);
    const joined = [...(res.errors || [])];
    setLoadErr(joined.length ? joined.slice(0, 3).join(' · ') : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onDownloadPdf = useCallback(() => {
    if (!payload || !payload.ok) return;
    setPdfWorking(true);
    try {
      downloadAdminReportsBundlePdf(payload);
    } catch (e) {
      setLoadErr(e?.message || 'Could not build PDF.');
    } finally {
      setPdfWorking(false);
    }
  }, [payload]);

  const channelRows = useMemo(() => {
    if (!payload?.ok || !payload.byChannel) return [];
    return Object.entries(payload.byChannel);
  }, [payload]);

  const withdrawalRows = useMemo(() => {
    if (!payload?.ok || !payload.withdrawalsCurr) return [];
    return ['pending', 'approved', 'paid', 'rejected']
      .map((k) => {
        const b = payload.withdrawalsCurr[k];
        if (!b || !b.count) return null;
        return { status: k, count: b.count, sum: b.sum };
      })
      .filter(Boolean);
  }, [payload]);

  useSetAdminHeaderActions(
    <>
      <AdminHeaderOutlineBtn type="button" disabled={loading || pdfWorking || !payload?.ok} onClick={onDownloadPdf}>
        {pdfWorking ? 'Building PDF…' : 'Download PDF'}
      </AdminHeaderOutlineBtn>
      <AdminHeaderRefresh onClick={() => load()} disabled={loading} />
    </>,
    [loading, load, pdfWorking, payload?.ok, onDownloadPdf],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <p className="admDim" style={{ margin: 0, fontSize: '0.82rem' }}>
          Rolling {ADMIN_REPORT_PERIOD_DAYS}-day slice · {payload?.ok ? payload.meta.rangeLabel : '—'}
        </p>
        <div className="admFilters">
          <input className="admInput admDateInput" readOnly value={`${ADMIN_REPORT_PERIOD_DAYS}d × 2 comparison`} />
        </div>
      </div>

      {loadErr ? (
        <p className="admModalErr" role="alert" style={{ marginBottom: '0.75rem' }}>
          {loadErr}
        </p>
      ) : null}

      <section className="admReportsGrid" style={{ marginBottom: '0.9rem' }}>
        {categories.map((item) => (
          <button
            key={item.key}
            type="button"
            className="admCard admReportCard"
            onClick={() => scrollToAnchor(item.anchor)}
          >
            <span className={`admReportIcon ${item.color}`}>{item.icon}</span>
            <strong>{item.title}</strong>
            <small>{item.description}</small>
            <span className={`admReportLink ${item.color}`}>View section ↓</span>
          </button>
        ))}
      </section>

      {loading ? (
        <section className="admCard admDim">Loading reports from database…</section>
      ) : !payload?.ok ? null : (
        <>
          <section id="adm-report-revenue" className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admSectionHeader">
              <div>
                <h3 style={{ margin: 0 }}>Revenue overview</h3>
                <p className="admDim" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>
                  Gross booking amounts exclude cancelled bookings; taxis use quoted_price at booking time.
                </p>
              </div>
            </div>
            <div className="admGrid4" style={{ marginBottom: '0.75rem' }}>
              <div className="admCard admSmallCard">
                <p className="k">Recent GMV</p>
                <p className="v">{formatGBP(payload.totals.revenueCurr)}</p>
                <small className="admDim">{pct(payload.totals.revenuePrev, payload.totals.revenueCurr)} vs prior window</small>
              </div>
              <div className="admCard admSmallCard">
                <p className="k">Prior GMV</p>
                <p className="v">{formatGBP(payload.totals.revenuePrev)}</p>
              </div>
              <div className="admCard admSmallCard">
                <p className="k">Commission policy</p>
                <p className="v" style={{ fontSize: '0.85rem' }}>
                  See PDF
                </p>
                <small className="admDim">{payload.meta.commissionNote}</small>
              </div>
              <div className="admCard admSmallCard">
                <p className="k">Generated snapshot</p>
                <p className="v" style={{ fontSize: '0.92rem', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(payload.meta.generatedAtISO).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="admTableWrap">
              <table className="admTable">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Orders (recent)</th>
                    <th>GMV recent</th>
                    <th>Orders (prior)</th>
                    <th>GMV prior</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map(([name, row]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{row.ordersCurr}</td>
                      <td style={{ fontWeight: 700 }}>{formatGBP(row.revenueCurr)}</td>
                      <td>{row.ordersPrev}</td>
                      <td style={{ fontWeight: 700 }}>{formatGBP(row.revenuePrev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="adm-report-orders" className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admSectionHeader">
              <h3 style={{ margin: 0 }}>Orders</h3>
            </div>
            <div className="admGrid3" style={{ marginBottom: '0.65rem' }}>
              <article className="admCard admSmallCard">
                <p className="k">Orders placed · recent</p>
                <p className="v">{payload.totals.ordersCurr}</p>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">Completion-style rate∗ · recent</p>
                <p className="v">{payload.totals.completionCurr}%</p>
                <small className="admDim">
                  Done {payload.totals.doneCurr} / Total {payload.totals.ordersCurr}
                </small>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">Cancellations · recent</p>
                <p className="v" style={{ color: '#d34444' }}>
                  {payload.totals.cancelCurr}
                </p>
              </article>
            </div>
            <p className="admDim" style={{ fontSize: '0.75rem', margin: '0 0 0.5rem' }}>
              ∗ Deliveries/shops counted when status is delivered; rides when completed — same logic as Analytics.
            </p>
          </section>

          <section id="adm-report-drivers" className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admSectionHeader">
              <h3 style={{ margin: 0 }}>Drivers</h3>
            </div>
            <div className="admGrid2" style={{ marginBottom: '0.65rem', maxWidth: 520 }}>
              <article className="admCard admSmallCard">
                <p className="k">Approved drivers</p>
                <p className="v">{payload.drivers.approved}</p>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">Pending registration</p>
                <p className="v">{payload.drivers.pendingRegistrations}</p>
              </article>
            </div>
          </section>

          <section id="adm-report-customers" className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admSectionHeader">
              <h3 style={{ margin: 0 }}>Customers</h3>
            </div>
            <div className="admGrid3" style={{ marginBottom: '0.65rem' }}>
              <article className="admCard admSmallCard">
                <p className="k">Registered profiles∗∗</p>
                <p className="v">{payload.customers.totalUsersApprox}</p>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">New registrations · recent</p>
                <p className="v">{payload.customers.signupsCurr}</p>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">New registrations · prior</p>
                <p className="v">{payload.customers.signupsPrev}</p>
              </article>
            </div>
            <small className="admDim">
              ∗∗ app_users approximate count · guests without accounts excluded.
            </small>
          </section>

          <section id="adm-report-reviews" className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admSectionHeader">
              <h3 style={{ margin: 0 }}>Trip reviews</h3>
            </div>
            <div className="admGrid2" style={{ maxWidth: 520 }}>
              <article className="admCard admSmallCard">
                <p className="k">Recent window · count / avg ★</p>
                <p className="v">
                  {payload.reviews.countCurr} /{' '}
                  {payload.reviews.avgCurr != null ? `${payload.reviews.avgCurr}` : '—'}
                </p>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">Prior window · count / avg ★</p>
                <p className="v">
                  {payload.reviews.countPrev} /{' '}
                  {payload.reviews.avgPrev != null ? `${payload.reviews.avgPrev}` : '—'}
                </p>
              </article>
            </div>
          </section>

          <section id="adm-report-payouts" className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admSectionHeader">
              <h3 style={{ margin: 0 }}>Withdrawals (recent window)</h3>
              <p className="admDim" style={{ margin: 0 }}>
                requested_at filtered to rolling recent window · values are requested amounts.
              </p>
            </div>
            <div className="admTableWrap">
              <table className="admTable">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Requests</th>
                    <th>Total amount</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawalRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="admDim">
                        No withdrawal rows in recent window.
                      </td>
                    </tr>
                  ) : (
                    withdrawalRows.map((w) => (
                      <tr key={w.status}>
                        <td style={{ textTransform: 'capitalize' }}>{w.status}</td>
                        <td>{w.count}</td>
                        <td style={{ fontWeight: 700 }}>{formatGBP(w.sum)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admCard admInsightCard">
            <h4 style={{ marginTop: 0 }}>📌 Highlights</h4>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {payload.insights.map((ln) => (
                <li key={ln}>{ln}</li>
              ))}
            </ul>
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem' }} className="admDim">
              Every section above — plus geography — ships together inside the downloadable PDF bundle.
            </p>
          </section>
        </>
      )}

      <section className="admCard admDim" style={{ marginTop: '0.9rem', fontSize: '0.82rem' }}>
        Automated email scheduling is not hooked up server-side yet. Export the bundled PDF locally and circulate as needed.
      </section>
    </div>
  );
}
