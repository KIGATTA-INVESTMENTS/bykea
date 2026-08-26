import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { formatGBP } from './currency';

export const ADMIN_REPORT_PERIOD_DAYS = 28;

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

function revenueExcludeCancelled(status, amount) {
  if (String(status || '').toLowerCase() === 'cancelled') return 0;
  const n = Number(amount || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function areaKey(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const seg = t.split(',')[0]?.trim()?.slice(0, 48);
  return seg || null;
}

function bumpDone(row, channel) {
  const s = String(row.status || '').toLowerCase();
  if (channel === 'delivery') return s === 'delivered';
  if (channel === 'shop') return s === 'delivered';
  return s === 'completed';
}

function pctVersus(prev, curr) {
  if (prev <= 0 && curr > 0) return 'New vs prior window';
  if (prev <= 0) return '—';
  const p = Math.round(((curr - prev) / prev) * 100);
  if (p > 0) return `+${p}%`;
  if (p < 0) return `${p}%`;
  return '0%';
}

function isOptionalSourceError(msg) {
  return /does not exist|schema cache|relation|permission denied/i.test(String(msg || ''));
}

function emptyChannel() {
  return {
    ordersCurr: 0,
    ordersPrev: 0,
    revenueCurr: 0,
    revenuePrev: 0,
    doneCurr: 0,
    donePrev: 0,
    cancelCurr: 0,
    cancelPrev: 0,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient | null | undefined} supabase
 */
export async function fetchAdminReportPayload(supabase) {
  if (!supabase) {
    return { ok: false, errorMessage: 'Database is not configured.' };
  }

  const errs = [];
  const now = new Date();
  const currEnd = endOfLocalDay(now).toISOString();
  const currStart = startOfLocalDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - (ADMIN_REPORT_PERIOD_DAYS - 1)),
  ).toISOString();

  const prevPeriodEnd = new Date(new Date(currStart).getTime() - 1);
  const prevEnd = endOfLocalDay(prevPeriodEnd).toISOString();
  const prevStart = startOfLocalDay(
    new Date(
      prevPeriodEnd.getFullYear(),
      prevPeriodEnd.getMonth(),
      prevPeriodEnd.getDate() - (ADMIN_REPORT_PERIOD_DAYS - 1),
    ),
  ).toISOString();

  /** @type {Record<string, ReturnType<typeof emptyChannel>>} */
  const ch = {
    Delivery: emptyChannel(),
    Taxi: emptyChannel(),
    'Tuk-Tuk': emptyChannel(),
    Shop: emptyChannel(),
  };

  try {
    const [appNewC, appNewP, delRes, txRes, tkRes, shopRes, wRes, revRes, drvApp, drvPending, commRes] = await Promise.all([
      supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('created_at', currStart).lte('created_at', currEnd),
      supabase.from('app_users').select('*', { count: 'exact', head: true }).gte('created_at', prevStart).lte('created_at', prevEnd),
      supabase
        .from('customer_delivery_orders')
        .select('created_at, status, total_amount, pickup_location')
        .gte('created_at', prevStart)
        .lte('created_at', currEnd),
      supabase.from('taxi_bookings').select('created_at, status, quoted_price, pickup_location').gte('created_at', prevStart).lte('created_at', currEnd),
      supabase.from('tuk_tuk_bookings').select('created_at, status, quoted_price, pickup_location').gte('created_at', prevStart).lte('created_at', currEnd),
      supabase.from('shop_customer_orders').select('placed_at, status, subtotal, customer_address').gte('placed_at', prevStart).lte('placed_at', currEnd),
      supabase
        .from('driver_withdrawal_requests')
        .select('status, amount, requested_at')
        .gte('requested_at', currStart)
        .lte('requested_at', currEnd),
      supabase.from('trip_reviews').select('rating, created_at').gte('created_at', prevStart).lte('created_at', currEnd),
      supabase.from('driver_registrations').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('driver_registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('platform_commission_settings').select('driver_commission_percent, shop_commission_percent').eq('id', 1).maybeSingle(),
    ]);

    if (appNewC.error) errs.push(appNewC.error.message);
    if (appNewP.error) errs.push(appNewP.error.message);
    if (delRes.error) errs.push(delRes.error.message);
    if (txRes.error) errs.push(txRes.error.message);
    if (tkRes.error) errs.push(tkRes.error.message);
    if (shopRes.error) errs.push(shopRes.error.message);
    if (drvApp.error) errs.push(drvApp.error.message);
    if (drvPending.error) errs.push(drvPending.error.message);

    const bookingsOk = !(delRes.error && txRes.error && tkRes.error && shopRes.error);
    if (!bookingsOk) {
      return {
        ok: false,
        errorMessage: 'Could not load booking tables. Check Supabase tables and RLS policies.',
        errors: errs,
      };
    }

    const reviewsOk = !revRes.error;
    const withdrawalsOk = !wRes.error;
    if (wRes.error && !isOptionalSourceError(wRes.error.message)) errs.push(wRes.error.message);
    if (revRes.error && !isOptionalSourceError(revRes.error.message)) errs.push(revRes.error.message);

    const dels = Array.isArray(delRes.data) ? delRes.data : [];
    const txs = Array.isArray(txRes.data) ? txRes.data : [];
    const tks = Array.isArray(tkRes.data) ? tkRes.data : [];
    const shops = Array.isArray(shopRes.data) ? shopRes.data : [];

    const ingest = (row, iso, bucket, amtField, revenueKind) => {
      const stat = row.status;
      const inC = between(iso, currStart, currEnd);
      const inP = between(iso, prevStart, prevEnd);
      const canc = String(stat || '').toLowerCase() === 'cancelled';
      const amt = revenueExcludeCancelled(stat, row[amtField]);
      const done = bumpDone(row, revenueKind === 'delivery' ? 'delivery' : revenueKind === 'shop' ? 'shop' : 'taxi');

      if (inC) {
        bucket.ordersCurr += 1;
        bucket.revenueCurr += amt;
        if (canc) bucket.cancelCurr += 1;
        else if (done) bucket.doneCurr += 1;
      }
      if (inP) {
        bucket.ordersPrev += 1;
        bucket.revenuePrev += revenueExcludeCancelled(stat, row[amtField]);
        if (canc) bucket.cancelPrev += 1;
        else if (bumpDone(row, revenueKind === 'delivery' ? 'delivery' : revenueKind === 'shop' ? 'shop' : 'taxi'))
          bucket.donePrev += 1;
      }
    };

    dels.forEach((row) => ingest(row, row.created_at, ch.Delivery, 'total_amount', 'delivery'));
    txs.forEach((row) => ingest(row, row.created_at, ch.Taxi, 'quoted_price', 'taxi'));
    tks.forEach((row) => ingest(row, row.created_at, ch['Tuk-Tuk'], 'quoted_price', 'taxi'));
    shops.forEach((row) => ingest(row, row.placed_at, ch.Shop, 'subtotal', 'shop'));

    let ordersCurr = 0;
    let ordersPrev = 0;
    let revenueCurr = 0;
    let revenuePrev = 0;
    let doneCurr = 0;
    let donePrev = 0;
    let cancelCurr = 0;
    let cancelPrev = 0;

    Object.values(ch).forEach((b) => {
      ordersCurr += b.ordersCurr;
      ordersPrev += b.ordersPrev;
      revenueCurr += b.revenueCurr;
      revenuePrev += b.revenuePrev;
      doneCurr += b.doneCurr;
      donePrev += b.donePrev;
      cancelCurr += b.cancelCurr;
      cancelPrev += b.cancelPrev;
    });

    const completionCurr = ordersCurr > 0 ? Math.round(((100 * doneCurr) / ordersCurr) * 10) / 10 : 0;
    const completionPrev = ordersPrev > 0 ? Math.round(((100 * donePrev) / ordersPrev) * 10) / 10 : 0;

    /** @type {Record<string, number>} */
    const areaCurr = {};

    /** @param {unknown} iso */
    const bumpAreaLoc = (iso, loc) => {
      if (!between(iso, currStart, currEnd)) return;
      const k = areaKey(loc);
      if (!k) return;
      areaCurr[k] = (areaCurr[k] || 0) + 1;
    };

    dels.forEach((row) => bumpAreaLoc(row.created_at, row.pickup_location));
    txs.forEach((row) => bumpAreaLoc(row.created_at, row.pickup_location));
    tks.forEach((row) => bumpAreaLoc(row.created_at, row.pickup_location));
    shops.forEach((row) => bumpAreaLoc(row.placed_at, row.customer_address));

    const topAreas = Object.entries(areaCurr)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    /** @type {Record<string, { count: number; sum: number }>} */
    const byW = {};
    (wRes.data || []).forEach((w) => {
      const s = String(w.status || '').toLowerCase();
      const amt = Number(w.amount || 0);
      if (!byW[s]) byW[s] = { count: 0, sum: 0 };
      byW[s].count += 1;
      byW[s].sum += amt;
    });

    /** @typedef {{ iso: string, rating?: number }} R */
    const reviews = revRes.data || [];
    /** @type {number[]} */
    const rCurr = [];
    /** @type {number[]} */
    const rPrev = [];

    reviews.forEach((rw) => {
      const iso = rw.created_at;
      const r = Number(rw.rating);
      if (!Number.isFinite(r)) return;
      if (between(iso, currStart, currEnd)) rCurr.push(r);
      if (between(iso, prevStart, prevEnd)) rPrev.push(r);
    });

    const avg = (xs) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;

    /** @type {string[]} */
    const insights = [];
    insights.push(
      ordersCurr > ordersPrev ? 'Order volume is up versus the prior comparable window.'
        : ordersCurr < ordersPrev
          ? 'Order volume eased versus the prior window — review funnel and supply.'
          : 'Order volume is flat versus the prior window.',
    );
    insights.push(`${formatGBP(revenueCurr)} gross booking value (${ADMIN_REPORT_PERIOD_DAYS} days) vs ${formatGBP(revenuePrev)} prior window.`);
    if (completionCurr < completionPrev && ordersCurr > 0) {
      insights.push('Recorded completion rate fell slightly — inspect deliveries/trips stuck before delivered/completed.');
    }
    if (topAreas[0]) {
      insights.push(`Busiest pickup/address line recently: "${topAreas[0][0]}" (${topAreas[0][1]} placements).`);
    }

    const rangeLabel = `${new Date(currStart).toLocaleDateString()} – ${new Date(currEnd).toLocaleDateString()} (vs prior ${ADMIN_REPORT_PERIOD_DAYS} days)`;

    const driverPctNum = Number(commRes.data?.driver_commission_percent ?? 10);
    const shopPctNum = Number(commRes.data?.shop_commission_percent ?? 12);

    return {
      ok: true,
      errors: errs,
      meta: {
        generatedAtISO: now.toISOString(),
        currStart,
        currEnd,
        prevStart,
        prevEnd,
        rangeLabel,
        commissionNote: `Policy rates snapshot: drivers ${driverPctNum}%, shops ${shopPctNum}%`,
      },
      totals: {
        revenueCurr,
        revenuePrev,
        ordersCurr,
        ordersPrev,
        doneCurr,
        donePrev,
        cancelCurr,
        cancelPrev,
        completionCurr,
        completionPrev,
      },
      byChannel: { ...ch },
      sources: {
        bookings: true,
        signups: !(appNewC.error || appNewP.error),
        drivers: !(drvApp.error || drvPending.error),
        reviews: reviewsOk,
        withdrawals: withdrawalsOk,
      },
      customers: {
        signupsCurr: Number(appNewC.count ?? 0),
        signupsPrev: Number(appNewP.count ?? 0),
      },
      drivers: {
        approved: drvApp.count ?? 0,
        pendingRegistrations: drvPending.count ?? 0,
      },
      withdrawalsCurr: byW,
      reviews: {
        countCurr: rCurr.length,
        avgCurr: avg(rCurr),
        countPrev: rPrev.length,
        avgPrev: avg(rPrev),
      },
      geography: topAreas.map(([city, count]) => ({ city, orders: count })),
      insights,
    };
  } catch (e) {
    return { ok: false, errorMessage: e?.message || 'Failed to build report payload.', errors: errs };
  }
}

/**
 * @param {Exclude<Awaited<ReturnType<typeof fetchAdminReportPayload>>, { ok:false, errorMessage:string }>} payload
 */
export function downloadAdminReportsBundlePdf(payload) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const titleStyle = () => doc.setFont('helvetica', 'bold');

  doc.setFont('helvetica', 'normal');

  doc.setFontSize(15);
  titleStyle();
  doc.text('InGo — Admin report bundle', margin, margin);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated ${new Date(payload.meta.generatedAtISO).toLocaleString()}`, margin, margin + 18);

  doc.setFontSize(9);
  const splitRange = doc.splitTextToSize(payload.meta.rangeLabel, pageW - margin * 2);
  doc.text(splitRange, margin, margin + 34);
  doc.text(payload.meta.commissionNote, margin, margin + 34 + splitRange.length * 11);

  let y = margin + 54 + splitRange.length * 11;

  const addSectionHeading = (text) => {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(text, margin, y);
    doc.setFont('helvetica', 'normal');
    y += 16;
  };

  addSectionHeading('Executive summary');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Metric', `Current (${ADMIN_REPORT_PERIOD_DAYS}d)`, `Prior (${ADMIN_REPORT_PERIOD_DAYS}d)`, 'Change']],
    body: [
      [
        'Gross booking value (excl. cancelled amounts)',
        formatGBP(payload.totals.revenueCurr),
        formatGBP(payload.totals.revenuePrev),
        pctVersus(payload.totals.revenuePrev, payload.totals.revenueCurr),
      ],
      [
        'Orders placed',
        String(payload.totals.ordersCurr),
        String(payload.totals.ordersPrev),
        pctVersus(payload.totals.ordersPrev, payload.totals.ordersCurr),
      ],
      [
        'Completion indicator (delivered/completed)',
        `${payload.totals.completionCurr}% (${payload.totals.doneCurr} / ${payload.totals.ordersCurr})`,
        `${payload.totals.completionPrev}% (${payload.totals.donePrev} / ${payload.totals.ordersPrev})`,
        'See orders section',
      ],
      [
        'Cancellations',
        String(payload.totals.cancelCurr),
        String(payload.totals.cancelPrev),
        pctVersus(payload.totals.cancelPrev, payload.totals.cancelCurr),
      ],
    ],
    headStyles: { fillColor: [45, 184, 75], textColor: 255 },
  });
  y = /** @type {any} */ (doc).lastAutoTable.finalY + 22;

  addSectionHeading('Revenue & orders — by channel');

  /** @type {string[][]} */
  const chanBody = Object.entries(payload.byChannel).map(([name, b]) => {
    const cRateCurr = b.ordersCurr > 0 ? `${Math.round((100 * b.doneCurr) / b.ordersCurr)}%` : '—';
    const cRatePrev = b.ordersPrev > 0 ? `${Math.round((100 * b.donePrev) / b.ordersPrev)}%` : '—';

    return [
      name,
      String(b.ordersCurr),
      formatGBP(b.revenueCurr),
      cRateCurr,
      String(b.cancelCurr),
      String(b.ordersPrev),
      formatGBP(b.revenuePrev),
      cRatePrev,
      String(b.cancelPrev),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [
      ['Channel', 'Orders ↓recent', 'Revenue recent', '% done∗ recent', 'Cancellations recent', 'Orders prior', 'Revenue prior', '% done∗ prior', 'Cancell. prior'],
    ],
    body: chanBody,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [43, 120, 255], textColor: 255 },
  });
  doc.setFontSize(7);
  doc.setTextColor(100);
  doc.text('∗ “Done” = delivery/shop marked delivered or ride completed (from live booking tables).', margin, doc.lastAutoTable.finalY + 12);
  doc.setTextColor(0);

  y = /** @type {any} */ (doc).lastAutoTable.finalY + 28;

  addSectionHeading('Customers & registrations');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Measure', 'Value']],
    body: [
      ['New registrations — recent window', String(payload.customers.signupsCurr)],
      ['New registrations — prior window', String(payload.customers.signupsPrev)],
    ],
    headStyles: { fillColor: [236, 145, 32], textColor: 255 },
  });

  y = /** @type {any} */ (doc).lastAutoTable.finalY + 24;

  addSectionHeading('Drivers & fleet onboarding');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Measure', 'Value']],
    body: [
      ['Approved drivers', String(payload.drivers.approved)],
      ['Pending registrations', String(payload.drivers.pendingRegistrations)],
    ],
    headStyles: { fillColor: [130, 80, 200], textColor: 255 },
  });
  y = /** @type {any} */ (doc).lastAutoTable.finalY + 24;

  addSectionHeading('Withdrawal requests (recent window)');
  const wdKeys = ['pending', 'approved', 'paid', 'rejected'];
  /** @type {string[][]} */
  const wdBody = wdKeys
    .map((k) => {
      const b = payload.withdrawalsCurr[k];
      if (!b || b.count === 0) return null;
      return [k.charAt(0).toUpperCase() + k.slice(1), String(b.count), formatGBP(b.sum)];
    })
    .filter(Boolean);
  if (wdBody.length === 0) {
    wdBody.push(['None in window', '—', '—']);
  }
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Status', 'Count', 'Amount requested']],
    body: wdBody,
    headStyles: { fillColor: [45, 184, 75], textColor: 255 },
  });
  y = /** @type {any} */ (doc).lastAutoTable.finalY + 24;

  addSectionHeading('Trip reviews');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Slice', 'Count', 'Average rating']],
    body: [
      [
        `Recent (${ADMIN_REPORT_PERIOD_DAYS}d)`,
        String(payload.reviews.countCurr),
        payload.reviews.avgCurr != null ? String(payload.reviews.avgCurr) : '—',
      ],
      [
        'Prior window',
        String(payload.reviews.countPrev),
        payload.reviews.avgPrev != null ? String(payload.reviews.avgPrev) : '—',
      ],
    ],
    headStyles: { fillColor: [210, 70, 70], textColor: 255 },
  });
  y = /** @type {any} */ (doc).lastAutoTable.finalY + 24;

  addSectionHeading('Top pickup / address hints (recent window)');
  const geoRows =
    payload.geography.length === 0
      ? [['—', '0']]
      : payload.geography.map((g) => [g.city, String(g.orders)]);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Location (first comma segment)', 'Order placements']],
    body: geoRows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [60, 60, 72], textColor: 255 },
  });
  y = /** @type {any} */ (doc).lastAutoTable.finalY + 22;

  addSectionHeading('Narrative insights (auto)');
  let iy = y;
  doc.setFontSize(9);
  payload.insights.forEach((line, idx) => {
    const block = doc.splitTextToSize(`${idx + 1}. ${line}`, pageW - margin * 2);
    block.forEach((ln) => {
      if (iy > doc.internal.pageSize.getHeight() - 56) {
        doc.addPage();
        iy = margin;
      }
      doc.text(ln, margin, iy);
      iy += 13;
    });
    iy += 6;
  });

  doc.setFontSize(7);
  doc.setTextColor(120);
  if (payload.errors?.length) {
    const foot = payload.errors.slice(0, 3).join('; ');
    const note = doc.splitTextToSize(`Load notes: ${foot}`, pageW - margin * 2);
    note.forEach((ln, li) => {
      doc.text(ln, margin, doc.internal.pageSize.getHeight() - 28 + li * 10);
    });
  } else {
    doc.text(
      `Source: live database aggregates · ${ADMIN_REPORT_PERIOD_DAYS}-day comparison windows.`,
      margin,
      doc.internal.pageSize.getHeight() - 22,
    );
  }
  doc.setTextColor(0);

  const safeName = `InGo-admin-report-${new Date(payload.meta.generatedAtISO).toISOString().slice(0, 10)}.pdf`;
  doc.save(safeName);
}