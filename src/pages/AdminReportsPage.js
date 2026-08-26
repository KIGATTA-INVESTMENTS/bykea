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
import './adminReportsPremium.css';

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

  const showReviews =
    payload?.ok &&
    payload.sources?.reviews &&
    (payload.reviews.countCurr > 0 || payload.reviews.countPrev > 0);

  const showWithdrawals = payload?.ok && payload.sources?.withdrawals && withdrawalRows.length > 0;

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
    <div className="adm admrep-page">
      <div className="admrep-meta">
        <div>
          <p className="admrep-meta__period">
            Last {ADMIN_REPORT_PERIOD_DAYS} days · live database
          </p>
          <p className="admrep-meta__sub">
            {payload?.ok ? payload.meta.rangeLabel : loading ? 'Loading…' : '—'}
          </p>
        </div>
        {payload?.ok ? (
          <p className="admrep-meta__sub" style={{ margin: 0 }}>
            Updated {new Date(payload.meta.generatedAtISO).toLocaleString()}
          </p>
        ) : null}
      </div>

      {loadErr ? (
        <p className="admModalErr" role="alert" style={{ margin: 0 }}>
          {loadErr}
        </p>
      ) : null}

      {loading ? (
        <section className="admCard admDim">Loading reports from database…</section>
      ) : !payload?.ok ? null : (
        <>
          <section className="admGrid4 admrep-kpi">
            <article className="admCard admSmallCard">
              <p className="k">Gross booking value</p>
              <p className="v">{formatGBP(payload.totals.revenueCurr)}</p>
              <small className="admDim">{pct(payload.totals.revenuePrev, payload.totals.revenueCurr)} vs prior</small>
            </article>
            <article className="admCard admSmallCard">
              <p className="k">Orders placed</p>
              <p className="v">{payload.totals.ordersCurr.toLocaleString()}</p>
              <small className="admDim">{pct(payload.totals.ordersPrev, payload.totals.ordersCurr)} vs prior</small>
            </article>
            <article className="admCard admSmallCard">
              <p className="k">New customer sign-ups</p>
              <p className="v">{payload.customers.signupsCurr.toLocaleString()}</p>
              <small className="admDim">Prior window: {payload.customers.signupsPrev.toLocaleString()}</small>
            </article>
            <article className="admCard admSmallCard">
              <p className="k">Approved drivers</p>
              <p className="v">{payload.drivers.approved.toLocaleString()}</p>
              <small className="admDim">Pending onboarding: {payload.drivers.pendingRegistrations.toLocaleString()}</small>
            </article>
          </section>

          <section className="admCard">
            <div className="admSectionHeader">
              <div>
                <h3 style={{ margin: 0 }}>Revenue &amp; orders by channel</h3>
                <p className="admDim" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>
                  Delivery, taxi, tuk-tuk and shop — amounts exclude cancelled bookings.
                </p>
              </div>
            </div>
            <div className="admTableWrap">
              <table className="admTable">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Orders (recent)</th>
                    <th>GMV (recent)</th>
                    <th>Orders (prior)</th>
                    <th>GMV (prior)</th>
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

          <section className="admCard">
            <div className="admSectionHeader">
              <h3 style={{ margin: 0 }}>Order outcomes (recent window)</h3>
            </div>
            <div className="admGrid3">
              <article className="admCard admSmallCard">
                <p className="k">Completion rate</p>
                <p className="v">{payload.totals.completionCurr}%</p>
                <small className="admDim">
                  {payload.totals.doneCurr} delivered / completed of {payload.totals.ordersCurr} orders
                </small>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">Cancellations</p>
                <p className="v" style={{ color: '#d34444' }}>
                  {payload.totals.cancelCurr}
                </p>
                <small className="admDim">Prior window: {payload.totals.cancelPrev}</small>
              </article>
              <article className="admCard admSmallCard">
                <p className="k">Prior-window orders</p>
                <p className="v">{payload.totals.ordersPrev.toLocaleString()}</p>
                <small className="admDim">For comparison with recent {ADMIN_REPORT_PERIOD_DAYS} days</small>
              </article>
            </div>
          </section>

          {showWithdrawals ? (
            <section className="admCard">
              <div className="admSectionHeader">
                <h3 style={{ margin: 0 }}>Driver withdrawals (recent window)</h3>
              </div>
              <div className="admTableWrap">
                <table className="admTable">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Requests</th>
                      <th>Amount requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawalRows.map((w) => (
                      <tr key={w.status}>
                        <td style={{ textTransform: 'capitalize' }}>{w.status}</td>
                        <td>{w.count}</td>
                        <td style={{ fontWeight: 700 }}>{formatGBP(w.sum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {showReviews ? (
            <section className="admCard">
              <div className="admSectionHeader">
                <h3 style={{ margin: 0 }}>Trip reviews</h3>
              </div>
              <div className="admGrid2" style={{ maxWidth: 520 }}>
                <article className="admCard admSmallCard">
                  <p className="k">Recent window</p>
                  <p className="v">
                    {payload.reviews.countCurr} reviews
                    {payload.reviews.avgCurr != null ? ` · avg ${payload.reviews.avgCurr}★` : ''}
                  </p>
                </article>
                <article className="admCard admSmallCard">
                  <p className="k">Prior window</p>
                  <p className="v">
                    {payload.reviews.countPrev} reviews
                    {payload.reviews.avgPrev != null ? ` · avg ${payload.reviews.avgPrev}★` : ''}
                  </p>
                </article>
              </div>
            </section>
          ) : null}

          <p className="admrep-foot">
            All figures above are aggregated from your Supabase booking and account tables for the rolling{' '}
            {ADMIN_REPORT_PERIOD_DAYS}-day windows. Download PDF for the full export including geography and narrative
            notes.
          </p>
        </>
      )}
    </div>
  );
}
