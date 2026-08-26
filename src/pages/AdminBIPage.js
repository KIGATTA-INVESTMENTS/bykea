import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { formatUSD } from '../lib/currency';
import './adminPortal.css';

const ACTIVE_DAYS = 14;

function areaKey(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return '—';
  const seg = t.split(',')[0]?.trim()?.slice(0, 48);
  return seg || '—';
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return '—';
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function normEmail(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function normPhone(s) {
  return String(s || '').replace(/\D/g, '');
}

function isCompletedStatus(status, channel) {
  const s = String(status || '').toLowerCase();
  if (channel === 'delivery' || channel === 'shop') return s === 'delivered';
  return s === 'completed';
}

function isCancelledStatus(status) {
  return String(status || '').toLowerCase() === 'cancelled';
}

function deriveActiveStatus(lastIso, createdIso) {
  const ACTIVE_MS = ACTIVE_DAYS * 86400000;
  const now = Date.now();
  let last = 0;
  if (lastIso) {
    const t = new Date(lastIso).getTime();
    if (!Number.isNaN(t)) last = t;
  }
  const cre = createdIso ? new Date(createdIso).getTime() : 0;
  const ref = Math.max(last, cre);
  if (ref <= 0) return 'Inactive';
  if (now - ref <= ACTIVE_MS) return 'Active';
  return 'Inactive';
}

function statusClass(status) {
  if (status === 'Active') return 'admBadgeStatus admGreen';
  if (status === 'Suspended') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admGray';
}

function pct(completed, total) {
  if (!total) return '—';
  return `${Math.round((completed / total) * 100)}%`;
}

function avgMinutes(samples) {
  if (!samples.length) return '—';
  const sum = samples.reduce((a, b) => a + b, 0);
  return `${Math.round(sum / samples.length)} min`;
}

function localDayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function tsOf(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Escape a value for a CSV cell. */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Sort a copy of `rows` by `key` (via `extractors`) in the given direction. */
function sortRows(rows, key, dir, extractors) {
  if (!key || !extractors[key]) return rows;
  const get = extractors[key];
  const mult = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * mult;
  });
}

const CUSTOMER_SORT = {
  name: (r) => r.name.toLowerCase(),
  phone: (r) => r.phone,
  area: (r) => r.area.toLowerCase(),
  signedUp: (r) => r.signedUpTs,
  lastLogin: (r) => r.lastLoginTs,
  totalOrders: (r) => r.totalOrders,
  completedOrders: (r) => r.completedOrders,
  cancelledOrders: (r) => r.cancelledOrders,
  totalSpend: (r) => r.spendValue,
  lastOrderDate: (r) => r.lastOrderTs,
  status: (r) => r.status,
};

const BIKER_SORT = {
  name: (r) => r.name.toLowerCase(),
  phone: (r) => r.phone,
  area: (r) => r.area.toLowerCase(),
  signedUp: (r) => r.signedUpTs,
  lastLogin: (r) => r.lastLoginTs,
  totalDeliveries: (r) => r.totalDeliveries,
  completed: (r) => r.completed,
  failed: (r) => r.failed,
  completionRate: (r) => r.completionValue,
  totalEarnings: (r) => r.earningsValue,
  daysActiveThisMonth: (r) => r.daysActiveThisMonth,
  lastDeliveryDate: (r) => r.lastDeliveryTs,
  rating: (r) => r.ratingValue,
  status: (r) => r.status,
};

function SortTh({ label, k, sort, onSort, arrow }) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: active ? '#0b5fff' : undefined }}
      title="Click to sort"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {arrow(sort, k)}
    </th>
  );
}

function BiStat({ label, value, accent }) {
  return (
    <div
      className="admCard"
      style={{ padding: '0.7rem 0.85rem', margin: 0, borderColor: accent ? '#bcd0ff' : undefined, background: accent ? '#f5f8ff' : undefined }}
    >
      <p style={{ margin: 0, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#667085' }}>{label}</p>
      <p style={{ margin: '0.2rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: accent ? '#0b5fff' : '#101828' }}>{value}</p>
    </div>
  );
}

export default function AdminBIPage() {
  const [tab, setTab] = useState('customers');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customerRows, setCustomerRows] = useState([]);
  const [bikerRows, setBikerRows] = useState([]);
  const [search, setSearch] = useState('');
  const [custSort, setCustSort] = useState({ key: 'totalSpend', dir: 'desc' });
  const [bikerSort, setBikerSort] = useState({ key: 'totalEarnings', dir: 'desc' });

  const toggleSort = (setSort) => (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  const sortCustomers = toggleSort(setCustSort);
  const sortBikers = toggleSort(setBikerSort);
  const sortArrow = (sort, key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setCustomerRows([]);
      setBikerRows([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    const errs = [];

    try {
      const [
        { data: users, error: uErr },
        { data: drivers, error: dErr },
        { data: dels, error: e1 },
        { data: txs, error: e2 },
        { data: tks, error: e3 },
        { data: shops, error: e4 },
        { data: reviews, error: e5 },
      ] = await Promise.all([
        supabase.from('app_users').select('id, full_name, phone, email, created_at').order('created_at', { ascending: false }),
        supabase.from('driver_registrations').select('id, full_name, phone, status, created_at, updated_at').eq('status', 'approved').order('created_at', { ascending: false }),
        supabase.from('customer_delivery_orders').select('id, app_user_id, assigned_driver_id, status, created_at, assigned_at, completed_at, pickup_location, driver_live_updated_at, total_amount'),
        supabase.from('taxi_bookings').select('id, app_user_id, assigned_driver_id, status, created_at, assigned_at, completed_at, pickup_location, driver_live_updated_at, quoted_price'),
        supabase.from('tuk_tuk_bookings').select('id, app_user_id, assigned_driver_id, status, created_at, assigned_at, completed_at, pickup_location, driver_live_updated_at, quoted_price'),
        supabase.from('shop_customer_orders').select('id, customer_email, customer_phone, assigned_driver_id, status, placed_at, assigned_at, completed_at, customer_address, driver_live_updated_at, subtotal'),
        supabase.from('trip_reviews').select('reviewee_driver_id, rating').eq('reviewee_role', 'driver'),
      ]);

      [uErr, dErr, e1, e2, e3, e4, e5].forEach((e) => {
        if (e) errs.push(e.message);
      });

      const userRows = Array.isArray(users) ? users : [];
      const driverRows = Array.isArray(drivers) ? drivers : [];

      /** @type {Record<string, { total: number; completed: number; cancelled: number; spend: number; lastOrder: string | null; lastArea: string | null; lastActivity: string | null }>} */
      const custAgg = {};

      const bumpCustomer = (uid, iso, status, channel, location, amount) => {
        if (!uid) return;
        if (!custAgg[uid]) {
          custAgg[uid] = { total: 0, completed: 0, cancelled: 0, spend: 0, lastOrder: null, lastArea: null, lastActivity: null };
        }
        const a = custAgg[uid];
        a.total += 1;
        if (isCompletedStatus(status, channel)) {
          a.completed += 1;
          a.spend += num(amount);
        }
        if (isCancelledStatus(status)) a.cancelled += 1;
        if (iso) {
          if (!a.lastOrder || new Date(iso) > new Date(a.lastOrder)) {
            a.lastOrder = iso;
            if (location) a.lastArea = areaKey(location);
          }
          if (!a.lastActivity || new Date(iso) > new Date(a.lastActivity)) a.lastActivity = iso;
        }
      };

      (dels || []).forEach((r) => bumpCustomer(r.app_user_id, r.created_at, r.status, 'delivery', r.pickup_location, r.total_amount));
      (txs || []).forEach((r) => bumpCustomer(r.app_user_id, r.created_at, r.status, 'taxi', r.pickup_location, r.quoted_price));
      (tks || []).forEach((r) => bumpCustomer(r.app_user_id, r.created_at, r.status, 'tuk', r.pickup_location, r.quoted_price));

      const userByEmail = {};
      const userByPhone = {};
      userRows.forEach((u) => {
        const e = normEmail(u.email);
        const ph = normPhone(u.phone);
        if (e) userByEmail[e] = u.id;
        if (ph) userByPhone[ph] = u.id;
      });

      (shops || []).forEach((r) => {
        const uid = userByEmail[normEmail(r.customer_email)] || userByPhone[normPhone(r.customer_phone)];
        bumpCustomer(uid, r.placed_at, r.status, 'shop', r.customer_address, r.subtotal);
      });

      const customers = userRows.map((u) => {
        const a = custAgg[u.id] || { total: 0, completed: 0, cancelled: 0, spend: 0, lastOrder: null, lastArea: null, lastActivity: null };
        const lastLoginIso = a.lastActivity || u.created_at;
        return {
          id: u.id,
          name: u.full_name?.trim() || '—',
          phone: u.phone || '—',
          area: a.lastArea || '—',
          signedUp: formatDate(u.created_at),
          signedUpTs: tsOf(u.created_at),
          lastLogin: formatDateTime(lastLoginIso),
          lastLoginTs: tsOf(lastLoginIso),
          totalOrders: a.total,
          completedOrders: a.completed,
          cancelledOrders: a.cancelled,
          spendValue: a.spend,
          totalSpend: formatUSD(a.spend),
          lastOrderDate: formatDate(a.lastOrder),
          lastOrderTs: tsOf(a.lastOrder),
          status: deriveActiveStatus(a.lastActivity, u.created_at),
        };
      });

      /** @type {Record<string, { sum: number; count: number }>} */
      const ratingByDriver = {};
      (reviews || []).forEach((r) => {
        if (!r.reviewee_driver_id) return;
        if (!ratingByDriver[r.reviewee_driver_id]) ratingByDriver[r.reviewee_driver_id] = { sum: 0, count: 0 };
        const n = Number(r.rating);
        if (!Number.isFinite(n)) return;
        ratingByDriver[r.reviewee_driver_id].sum += n;
        ratingByDriver[r.reviewee_driver_id].count += 1;
      });

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      /** @type {Record<string, { total: number; completed: number; failed: number; earnings: number; durationMins: number[]; activeDays: Set<string>; lastDelivery: string | null; lastArea: string | null; lastLogin: string | null }>} */
      const driverAgg = {};

      const bumpDriver = (driverId, row, channel, amount) => {
        if (!driverId) return;
        if (!driverAgg[driverId]) {
          driverAgg[driverId] = {
            total: 0,
            completed: 0,
            failed: 0,
            earnings: 0,
            durationMins: [],
            activeDays: new Set(),
            lastDelivery: null,
            lastArea: null,
            lastLogin: null,
          };
        }
        const a = driverAgg[driverId];
        a.total += 1;

        const status = row.status;
        const completed = isCompletedStatus(status, channel);
        const cancelled = isCancelledStatus(status);

        if (completed) {
          a.completed += 1;
          a.earnings += num(amount);
          const doneIso = row.completed_at || row.placed_at || row.created_at;
          if (doneIso) {
            if (!a.lastDelivery || new Date(doneIso) > new Date(a.lastDelivery)) {
              a.lastDelivery = doneIso;
              const loc = row.pickup_location || row.customer_address;
              if (loc) a.lastArea = areaKey(loc);
            }
            const day = localDayKey(doneIso);
            if (day && new Date(doneIso) >= monthStart) a.activeDays.add(day);
          }
          if (row.assigned_at && row.completed_at) {
            const mins = (new Date(row.completed_at).getTime() - new Date(row.assigned_at).getTime()) / 60000;
            if (Number.isFinite(mins) && mins > 0 && mins < 24 * 60) a.durationMins.push(mins);
          }
        } else if (cancelled) {
          a.failed += 1;
        }

        const live = row.driver_live_updated_at;
        const activity = live || row.completed_at || row.assigned_at || row.placed_at || row.created_at;
        if (activity && (!a.lastLogin || new Date(activity) > new Date(a.lastLogin))) {
          a.lastLogin = activity;
          if (!a.lastArea) {
            const loc = row.pickup_location || row.customer_address;
            if (loc) a.lastArea = areaKey(loc);
          }
        }
      };

      (dels || []).forEach((r) => {
        if (r.assigned_driver_id) bumpDriver(r.assigned_driver_id, r, 'delivery', r.total_amount);
      });
      (txs || []).forEach((r) => {
        if (r.assigned_driver_id) bumpDriver(r.assigned_driver_id, r, 'taxi', r.quoted_price);
      });
      (tks || []).forEach((r) => {
        if (r.assigned_driver_id) bumpDriver(r.assigned_driver_id, r, 'tuk', r.quoted_price);
      });
      (shops || []).forEach((r) => {
        if (r.assigned_driver_id) bumpDriver(r.assigned_driver_id, r, 'shop', r.subtotal);
      });

      const bikers = driverRows.map((d) => {
        const a = driverAgg[d.id] || {
          total: 0,
          completed: 0,
          failed: 0,
          earnings: 0,
          durationMins: [],
          activeDays: new Set(),
          lastDelivery: null,
          lastArea: null,
          lastLogin: null,
        };
        const rating = ratingByDriver[d.id];
        const avgRating = rating?.count ? (rating.sum / rating.count).toFixed(1) : '—';
        const lastLoginIso = a.lastLogin || d.updated_at || d.created_at;

        return {
          id: d.id,
          name: d.full_name?.trim() || '—',
          phone: d.phone || '—',
          area: a.lastArea || '—',
          signedUp: formatDate(d.created_at),
          signedUpTs: tsOf(d.created_at),
          lastLogin: formatDateTime(lastLoginIso),
          lastLoginTs: tsOf(lastLoginIso),
          totalDeliveries: a.total,
          completed: a.completed,
          failed: a.failed,
          completionRate: pct(a.completed, a.total),
          completionValue: a.total ? a.completed / a.total : 0,
          earningsValue: a.earnings,
          totalEarnings: formatUSD(a.earnings),
          avgDeliveryTime: avgMinutes(a.durationMins),
          daysActiveThisMonth: a.activeDays.size,
          lastDeliveryDate: formatDate(a.lastDelivery),
          lastDeliveryTs: tsOf(a.lastDelivery),
          rating: avgRating,
          ratingValue: rating?.count ? rating.sum / rating.count : 0,
          status: deriveActiveStatus(lastLoginIso, d.created_at),
        };
      });

      setCustomerRows(customers);
      setBikerRows(bikers);
      setError(errs.length ? errs.slice(0, 2).join(' · ') : '');
    } catch (err) {
      setCustomerRows([]);
      setBikerRows([]);
      setError(err?.message || 'Failed to load BI data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const q = search.trim().toLowerCase();

  const filteredCustomers = useMemo(() => {
    const base = q ? customerRows.filter((r) => [r.name, r.phone, r.area, r.status].join(' ').toLowerCase().includes(q)) : customerRows;
    return sortRows(base, custSort.key, custSort.dir, CUSTOMER_SORT);
  }, [customerRows, q, custSort]);

  const filteredBikers = useMemo(() => {
    const base = q ? bikerRows.filter((r) => [r.name, r.phone, r.area, r.status].join(' ').toLowerCase().includes(q)) : bikerRows;
    return sortRows(base, bikerSort.key, bikerSort.dir, BIKER_SORT);
  }, [bikerRows, q, bikerSort]);

  const customerSummary = useMemo(() => {
    const totalSpend = customerRows.reduce((s, r) => s + r.spendValue, 0);
    const active = customerRows.filter((r) => r.status === 'Active').length;
    const totalOrders = customerRows.reduce((s, r) => s + r.totalOrders, 0);
    return {
      count: customerRows.length,
      active,
      totalSpend,
      avgSpend: customerRows.length ? totalSpend / customerRows.length : 0,
      totalOrders,
    };
  }, [customerRows]);

  const bikerSummary = useMemo(() => {
    const totalEarnings = bikerRows.reduce((s, r) => s + r.earningsValue, 0);
    const active = bikerRows.filter((r) => r.status === 'Active').length;
    const completed = bikerRows.reduce((s, r) => s + r.completed, 0);
    const totalJobs = bikerRows.reduce((s, r) => s + r.totalDeliveries, 0);
    return {
      count: bikerRows.length,
      active,
      totalEarnings,
      completionRate: pct(completed, totalJobs),
    };
  }, [bikerRows]);

  const exportCsv = useCallback(() => {
    if (tab === 'customers') {
      const headers = ['Name', 'Phone', 'Area / Zone', 'Signed Up', 'Last Login', 'Total Orders', 'Completed Orders', 'Cancelled Orders', 'Total Amount Spend', 'Last Order Date', 'Status'];
      const rows = filteredCustomers.map((r) => [r.name, r.phone, r.area, r.signedUp, r.lastLogin, r.totalOrders, r.completedOrders, r.cancelledOrders, r.spendValue.toFixed(2), r.lastOrderDate, r.status]);
      downloadCsv(`bi-customers-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    } else {
      const headers = ['Name', 'Phone', 'Area / Zone', 'Signed Up', 'Last Login', 'Total Deliveries', 'Completed', 'Failed', 'Completion Rate', 'Total Earnings', 'Avg Delivery Time', 'Days Active This Month', 'Last Delivery Date', 'Rating', 'Status'];
      const rows = filteredBikers.map((r) => [r.name, r.phone, r.area, r.signedUp, r.lastLogin, r.totalDeliveries, r.completed, r.failed, r.completionRate, r.earningsValue.toFixed(2), r.avgDeliveryTime, r.daysActiveThisMonth, r.lastDeliveryDate, r.rating, r.status]);
      downloadCsv(`bi-bikers-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    }
  }, [tab, filteredCustomers, filteredBikers]);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', maxWidth: '52rem' }}>
        Business intelligence overview for customers and bikers — live data from your database.
      </p>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="admTabs" role="tablist" aria-label="BI views">
            <button type="button" className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')} role="tab" aria-selected={tab === 'customers'}>
              Customers ({customerRows.length})
            </button>
            <button type="button" className={tab === 'bikers' ? 'active' : ''} onClick={() => setTab('bikers')} role="tab" aria-selected={tab === 'bikers'}>
              Bikers ({bikerRows.length})
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: '1 1 14rem', justifyContent: 'flex-end' }}>
            <div className="admSearch" style={{ flex: '1 1 12rem', maxWidth: '22rem', margin: 0 }}>
              <input placeholder="Search name, phone, area…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || (tab === 'customers' ? filteredCustomers.length === 0 : filteredBikers.length === 0)}
              title="Download the current view as a CSV file"
              style={{
                whiteSpace: 'nowrap',
                border: '1px solid #cfd6e4',
                background: '#fff',
                color: '#101828',
                borderRadius: 10,
                font: 'inherit',
                fontWeight: 700,
                padding: '0.6rem 0.95rem',
                cursor: 'pointer',
              }}
            >
              Export CSV
            </button>
          </div>
        </div>
      </section>

      <section className="admStatGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.65rem', marginBottom: '0.8rem' }}>
        {tab === 'customers' ? (
          <>
            <BiStat label="Total Customers" value={customerSummary.count} />
            <BiStat label="Active Customers" value={customerSummary.active} />
            <BiStat label="Total Amount Spend" value={formatUSD(customerSummary.totalSpend)} accent />
            <BiStat label="Avg Spend / Customer" value={formatUSD(customerSummary.avgSpend)} />
            <BiStat label="Total Orders" value={customerSummary.totalOrders} />
          </>
        ) : (
          <>
            <BiStat label="Total Bikers" value={bikerSummary.count} />
            <BiStat label="Active Bikers" value={bikerSummary.active} />
            <BiStat label="Total Earnings Paid Out" value={formatUSD(bikerSummary.totalEarnings)} accent />
            <BiStat label="Overall Completion Rate" value={bikerSummary.completionRate} />
          </>
        )}
      </section>

      {tab === 'customers' ? (
        <section className="admCard">
          <div className="admSectionHeader" style={{ marginBottom: '0.65rem' }}>
            <h3 style={{ margin: 0 }}>Customers</h3>
          </div>
          <div className="admTableWrap">
            <table className="admTable">
              <thead>
                <tr>
                  <SortTh label="Name" k="name" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Phone" k="phone" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Area / Zone" k="area" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Signed Up" k="signedUp" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Last Login" k="lastLogin" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Total Orders" k="totalOrders" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Completed Orders" k="completedOrders" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Cancelled Orders" k="cancelledOrders" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Total Amount Spend" k="totalSpend" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Last Order Date" k="lastOrderDate" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                  <SortTh label="Status" k="status" sort={custSort} onSort={sortCustomers} arrow={sortArrow} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '1.2rem' }} className="admDim">
                      Loading…
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '1.2rem' }} className="admDim">
                      No customers found.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.phone}</td>
                      <td>{r.area}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.signedUp}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{r.lastLogin}</td>
                      <td>{r.totalOrders}</td>
                      <td>{r.completedOrders}</td>
                      <td>{r.cancelledOrders}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.totalSpend}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.lastOrderDate}</td>
                      <td>
                        <span className={statusClass(r.status)}>{r.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="admCard">
          <div className="admSectionHeader" style={{ marginBottom: '0.65rem' }}>
            <h3 style={{ margin: 0 }}>Bikers</h3>
          </div>
          <div className="admTableWrap">
            <table className="admTable">
              <thead>
                <tr>
                  <SortTh label="Name" k="name" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Phone" k="phone" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Area / Zone" k="area" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Signed Up" k="signedUp" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Last Login" k="lastLogin" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Total Deliveries" k="totalDeliveries" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Completed" k="completed" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Failed" k="failed" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Completion Rate" k="completionRate" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Total Earnings" k="totalEarnings" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <th>Avg Delivery Time</th>
                  <SortTh label="Days Active This Month" k="daysActiveThisMonth" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Last Delivery Date" k="lastDeliveryDate" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Rating" k="rating" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                  <SortTh label="Status" k="status" sort={bikerSort} onSort={sortBikers} arrow={sortArrow} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={15} style={{ textAlign: 'center', padding: '1.2rem' }} className="admDim">
                      Loading…
                    </td>
                  </tr>
                ) : filteredBikers.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ textAlign: 'center', padding: '1.2rem' }} className="admDim">
                      No bikers found.
                    </td>
                  </tr>
                ) : (
                  filteredBikers.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.phone}</td>
                      <td>{r.area}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.signedUp}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{r.lastLogin}</td>
                      <td>{r.totalDeliveries}</td>
                      <td>{r.completed}</td>
                      <td>{r.failed}</td>
                      <td>{r.completionRate}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.totalEarnings}</td>
                      <td>{r.avgDeliveryTime}</td>
                      <td>{r.daysActiveThisMonth}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.lastDeliveryDate}</td>
                      <td>{r.rating === '—' ? '—' : `${r.rating} / 5`}</td>
                      <td>
                        <span className={statusClass(r.status)}>{r.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
