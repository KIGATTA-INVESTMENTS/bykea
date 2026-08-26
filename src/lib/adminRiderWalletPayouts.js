import { fetchPlatformCommissionSettings } from './platformCommissionSettings';
import { isSupabaseConfigured, supabase } from './supabaseClient';

function netAfterCommission(gross, pct) {
  const g = Number(gross) || 0;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const commission = Math.round(g * (p / 100) * 100) / 100;
  return Math.round((g - commission) * 100) / 100;
}

function shortRef(prefix, id) {
  const short = String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return short ? `${prefix}-${short}` : '—';
}

/**
 * Load wallet-paid completed jobs + payout status for admin rider payouts.
 * @returns {Promise<{ rows: object[], error: string | null }>}
 */
export async function fetchAdminRiderWalletPayoutJobs() {
  if (!isSupabaseConfigured || !supabase) {
    return { rows: [], error: 'Database is not configured.' };
  }

  const { data: commissionRow } = await fetchPlatformCommissionSettings(supabase);
  const commissionPct = Number(commissionRow?.driver_commission_percent);
  const pct = Number.isFinite(commissionPct) ? Math.max(0, Math.min(100, commissionPct)) : 0;

  const [delRes, shopRes, taxiRes, tukRes, payoutRes] = await Promise.all([
    supabase
      .from('customer_delivery_orders')
      .select('id, assigned_driver_id, total_amount, payment_method, status, completed_at, created_at, dropoff_location')
      .eq('payment_method', 'wallet')
      .eq('status', 'delivered')
      .not('assigned_driver_id', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(300),
    supabase
      .from('shop_customer_orders')
      .select('id, assigned_driver_id, subtotal, delivery_fee, payment_method, status, placed_at, order_number, customer_address')
      .eq('payment_method', 'wallet')
      .in('status', ['delivered', 'completed'])
      .not('assigned_driver_id', 'is', null)
      .order('placed_at', { ascending: false })
      .limit(300),
    supabase
      .from('taxi_bookings')
      .select('id, assigned_driver_id, quoted_price, payment_method, status, completed_at, created_at, destination_location')
      .eq('payment_method', 'wallet')
      .eq('status', 'completed')
      .not('assigned_driver_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('tuk_tuk_bookings')
      .select('id, assigned_driver_id, quoted_price, payment_method, status, completed_at, created_at, destination_location')
      .eq('payment_method', 'wallet')
      .eq('status', 'completed')
      .not('assigned_driver_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('driver_wallet_job_payouts').select('*').order('created_at', { ascending: false }).limit(800),
  ]);

  const missingTable =
    /does not exist|schema cache|Could not find the table|payment_method/i.test(
      [delRes.error, shopRes.error, taxiRes.error, tukRes.error, payoutRes.error]
        .map((e) => e?.message || '')
        .join(' '),
    );

  if (payoutRes.error && /driver_wallet_job_payouts/i.test(payoutRes.error.message || '')) {
    return {
      rows: [],
      error: 'Run supabase/admin_customer_wallet.sql in the SQL editor, then refresh.',
    };
  }

  const payoutByKey = {};
  for (const p of payoutRes.data || []) {
    payoutByKey[`${p.booking_table}:${p.booking_id}`] = p;
  }

  /** @type {object[]} */
  const jobs = [];

  for (const r of delRes.data || []) {
    const gross = Number(r.total_amount) || 0;
    const net = netAfterCommission(gross, pct);
    const key = `customer_delivery_orders:${r.id}`;
    const payout = payoutByKey[key];
    jobs.push({
      key,
      bookingTable: 'customer_delivery_orders',
      bookingId: r.id,
      kind: 'Delivery',
      ref: shortRef('DEL', r.id),
      driverId: r.assigned_driver_id,
      gross,
      net: payout ? Number(payout.net_amount_gbp) : net,
      commissionPct: payout ? Number(payout.commission_pct) : pct,
      at: r.completed_at || r.created_at,
      to: r.dropoff_location || '—',
      payoutStatus: payout?.status || 'pending',
      payoutId: payout?.id || null,
      paidAt: payout?.paid_at || null,
    });
  }

  for (const r of shopRes.data || []) {
    const gross = Math.round(((Number(r.subtotal) || 0) + (Number(r.delivery_fee) || 0)) * 100) / 100;
    const net = netAfterCommission(gross, pct);
    const key = `shop_customer_orders:${r.id}`;
    const payout = payoutByKey[key];
    jobs.push({
      key,
      bookingTable: 'shop_customer_orders',
      bookingId: r.id,
      kind: 'Shop',
      ref: r.order_number || shortRef('SHP', r.id),
      driverId: r.assigned_driver_id,
      gross,
      net: payout ? Number(payout.net_amount_gbp) : net,
      commissionPct: payout ? Number(payout.commission_pct) : pct,
      at: r.placed_at,
      to: r.customer_address || '—',
      payoutStatus: payout?.status || 'pending',
      payoutId: payout?.id || null,
      paidAt: payout?.paid_at || null,
    });
  }

  for (const r of taxiRes.data || []) {
    const gross = Number(r.quoted_price) || 0;
    const net = netAfterCommission(gross, pct);
    const key = `taxi_bookings:${r.id}`;
    const payout = payoutByKey[key];
    jobs.push({
      key,
      bookingTable: 'taxi_bookings',
      bookingId: r.id,
      kind: 'Taxi',
      ref: shortRef('TXI', r.id),
      driverId: r.assigned_driver_id,
      gross,
      net: payout ? Number(payout.net_amount_gbp) : net,
      commissionPct: payout ? Number(payout.commission_pct) : pct,
      at: r.completed_at || r.created_at,
      to: r.destination_location || '—',
      payoutStatus: payout?.status || 'pending',
      payoutId: payout?.id || null,
      paidAt: payout?.paid_at || null,
    });
  }

  for (const r of tukRes.data || []) {
    const gross = Number(r.quoted_price) || 0;
    const net = netAfterCommission(gross, pct);
    const key = `tuk_tuk_bookings:${r.id}`;
    const payout = payoutByKey[key];
    jobs.push({
      key,
      bookingTable: 'tuk_tuk_bookings',
      bookingId: r.id,
      kind: 'Tuk-Tuk',
      ref: shortRef('TUK', r.id),
      driverId: r.assigned_driver_id,
      gross,
      net: payout ? Number(payout.net_amount_gbp) : net,
      commissionPct: payout ? Number(payout.commission_pct) : pct,
      at: r.completed_at || r.created_at,
      to: r.destination_location || '—',
      payoutStatus: payout?.status || 'pending',
      payoutId: payout?.id || null,
      paidAt: payout?.paid_at || null,
    });
  }

  jobs.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  if (missingTable && jobs.length === 0 && !payoutRes.error) {
    return {
      rows: [],
      error: 'Could not load wallet-paid jobs. Ensure payment_method=wallet columns exist (run customer_wallet_checkout.sql).',
    };
  }

  return { rows: jobs, error: null };
}

/**
 * Mark a wallet-paid job as paid out to the rider.
 * @param {object} job from fetchAdminRiderWalletPayoutJobs
 */
export async function markRiderWalletJobPaid(job) {
  if (!isSupabaseConfigured || !supabase || !job?.bookingId || !job?.driverId) {
    return { ok: false, error: 'Missing job details.' };
  }

  const now = new Date().toISOString();
  const payload = {
    driver_id: job.driverId,
    booking_table: job.bookingTable,
    booking_id: job.bookingId,
    gross_amount_gbp: Math.round((Number(job.gross) || 0) * 100) / 100,
    commission_pct: Number(job.commissionPct) || 0,
    net_amount_gbp: Math.round((Number(job.net) || 0) * 100) / 100,
    status: 'paid',
    paid_at: now,
    updated_at: now,
  };

  if (job.payoutId) {
    const { error } = await supabase
      .from('driver_wallet_job_payouts')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', job.payoutId);
    if (error) {
      return { ok: false, error: error.message || 'Could not mark paid.' };
    }
    return { ok: true };
  }

  const { error } = await supabase.from('driver_wallet_job_payouts').upsert(payload, {
    onConflict: 'booking_table,booking_id',
  });
  if (error) {
    if (/does not exist|schema cache|Could not find the table/i.test(error.message || '')) {
      return { ok: false, error: 'Run supabase/admin_customer_wallet.sql in the SQL editor, then try again.' };
    }
    return { ok: false, error: error.message || 'Could not mark paid.' };
  }
  return { ok: true };
}
