import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

const ACTIVE_DAYS = 14;

/** @typedef {{ id: string; name: string; phone: string; email: string; referralCode: string | null; orders: number; spent: number; joined: string; status: string; lastActive: string; lastActivityIso: string | null }} CustomerRow */

function normEmail(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function normPhone(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Case-insensitive match on name, email, phone; digit-only match on phone; partial UUID match. */
function customerMatchesQuery(c, rawSearch) {
  const trimmed = String(rawSearch ?? '').trim();
  if (!trimmed) return true;
  const q = trimmed.toLowerCase();
  const qDigits = trimmed.replace(/\D/g, '');
  const name = String(c.name ?? '').toLowerCase();
  const email = String(c.email ?? '').toLowerCase();
  const phoneRaw = String(c.phone ?? '');
  const phoneLower = phoneRaw.toLowerCase();
  const phoneDigits = normPhone(phoneRaw);
  const idCompact = String(c.id ?? '')
    .toLowerCase()
    .replace(/-/g, '');
  if (name.includes(q) || email.includes(q) || phoneLower.includes(q)) return true;
  if (qDigits.length >= 3 && phoneDigits.includes(qDigits)) return true;
  const qId = trimmed.toLowerCase().replace(/-/g, '');
  if (qId.length >= 6 && idCompact.includes(qId)) return true;
  return false;
}

function initials(name) {
  const n = String(name || '').trim();
  if (!n) return '??';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function joinLabel(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return '—';
  }
}

function timeAgo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d ago`;
  return joinLabel(iso);
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function statusClass(status) {
  if (status === 'Active') return 'admBadgeStatus admGreen';
  return 'admBadgeStatus admGray';
}

function shortRef(kind, uuid) {
  const short = String(uuid || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  if (!short) return '—';
  const p = kind === 'del' ? 'DEL' : kind === 'txi' ? 'TXI' : kind === 'tuk' ? 'TUK' : 'SHP';
  return `${p}-${short}`;
}

/** @typedef {{ iso: string; line: string }} RecentLine */

/**
 * @param {string | null | undefined} lastIso
 * @param {string} createdIso
 */
function deriveStatus(lastIso, createdIso) {
  const ACTIVE_MS = ACTIVE_DAYS * 86400000;
  const now = Date.now();
  let last = 0;
  if (lastIso) {
    last = new Date(lastIso).getTime();
    if (!Number.isNaN(last)) {
      // ok
    } else {
      last = 0;
    }
  }
  const cre = createdIso ? new Date(createdIso).getTime() : 0;
  const ref = Math.max(last, cre);
  if (ref <= 0) return 'Inactive';
  if (now - ref <= ACTIVE_MS) return 'Active';
  return 'Inactive';
}

export default function AdminCustomerManagementPage() {
  const [customers, setCustomers] = useState([]); // CustomerRow[]
  const [recentByUserId, setRecentByUserId] = useState({}); // Record<string, RecentLine[]>
  /** @type {{ id: string; name: string } | null} */
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest'); // newest | orders | spent
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  /** @type {[number, number, number] | null} */
  const [stats, setStats] = useState(null); // [total, activeToday, newWeek]

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setCustomers([]);
      setStats([0, 0, 0]);
      setError('Database is not configured.');
      return;
    }

    setLoading(true);
    try {
      const errs = [];

      const { data: users, error: uErr } = await supabase
        .from('app_users')
        .select('id, full_name, phone, email, referral_code, created_at')
        .order('created_at', { ascending: false });

      if (uErr) {
        errs.push(uErr.message);
        setCustomers([]);
        setRecentByUserId({});
        setStats([0, 0, 0]);
        setError(errs.join(' · '));
        return;
      }

      const userRows = Array.isArray(users) ? users : [];

      const [
        { data: dels, error: e1 },
        { data: txs, error: e2 },
        { data: tks, error: e3 },
        { data: shops, error: e4 },
      ] = await Promise.all([
        supabase.from('customer_delivery_orders').select('id, app_user_id, created_at, total_amount, status'),
        supabase.from('taxi_bookings').select('id, app_user_id, created_at, quoted_price, status'),
        supabase.from('tuk_tuk_bookings').select('id, app_user_id, created_at, quoted_price, status'),
        supabase.from('shop_customer_orders').select(
          'id, order_number, customer_email, customer_phone, placed_at, subtotal, status',
        ),
      ]);

      [e1, e2, e3, e4].forEach((e) => {
        if (e) errs.push(e.message);
      });

      /** @type {Record<string, { orders: number; spent: number; last: string | null; items: RecentLine[] }>} */
      const agg = {};

      const ensure = (uid) => {
        if (!uid) return;
        if (!agg[uid])
          agg[uid] = { orders: 0, spent: 0, last: null, items: [] };
      };

      const pushActivity = (uid, iso, amount, status, kindLabel, oid, orderTag) => {
        if (!uid) return;
        ensure(uid);
        const a = agg[uid];
        a.orders += 1;
        if (String(status || '').toLowerCase() !== 'cancelled') {
          const n = Number(amount || 0);
          if (Number.isFinite(n)) a.spent += n;
        }
        if (iso) {
          if (!a.last || new Date(iso) > new Date(a.last)) a.last = iso;
          const amt = Number(amount || 0);
          const lbl = `${orderTag || shortRef(kindLabel, oid)} · ${status || '—'} · ${Number.isFinite(amt) ? formatGBP(amt) : '—'}`;
          a.items.push({ iso, line: lbl });
        }
      };

      (dels || []).forEach((r) => {
        if (!r.app_user_id) return;
        pushActivity(r.app_user_id, r.created_at, r.total_amount, r.status, 'del', r.id, null);
      });
      (txs || []).forEach((r) => {
        if (!r.app_user_id) return;
        pushActivity(r.app_user_id, r.created_at, r.quoted_price, r.status, 'txi', r.id, null);
      });
      (tks || []).forEach((r) => {
        if (!r.app_user_id) return;
        pushActivity(r.app_user_id, r.created_at, r.quoted_price, r.status, 'tuk', r.id, null);
      });

      const userByEmail = {};
      const userByPhone = {};
      userRows.forEach((u) => {
        const e = normEmail(u.email);
        const ph = normPhone(u.phone);
        if (e) userByEmail[e] = u.id;
        if (ph) userByPhone[ph] = u.id;
      });

      (shops || []).forEach((r) => {
        const e = normEmail(r.customer_email);
        const ph = normPhone(r.customer_phone);
        const uid = userByEmail[e] || userByPhone[ph];
        if (!uid) return;
        const tag = r.order_number || shortRef('shp', r.id);
        pushActivity(uid, r.placed_at, r.subtotal, r.status, 'shp', r.id, tag);
      });

      /** @type {Record<string, RecentLine[]>} */
      const recentMap = {};
      Object.keys(agg).forEach((uid) => {
        const sorted = [...(agg[uid].items || [])].sort((a, b) => new Date(b.iso).getTime() - new Date(a.iso).getTime());
        agg[uid].items = sorted;
        recentMap[uid] = sorted.slice(0, 8);
      });
      setRecentByUserId(recentMap);

      const startedToday = startOfLocalDay().getTime();
      const weekStart = startOfLocalDay(new Date(Date.now() - 6 * 86400000)).getTime(); // rolling 7d

      let activeToday = 0;
      let newWeek = 0;

      /** @type {CustomerRow[]} */
      const rows = userRows.map((u) => {
        const a = agg[u.id] || { orders: 0, spent: 0, last: null, items: [] };
        const lastBooking = a.last;
        const displayLast = lastBooking || u.created_at;
        const st = deriveStatus(a.last, u.created_at);

        if (lastBooking && new Date(lastBooking).getTime() >= startedToday) activeToday += 1;
        if (u.created_at && new Date(u.created_at).getTime() >= weekStart) newWeek += 1;

        return {
          id: u.id,
          name: u.full_name?.trim() || '—',
          phone: u.phone ?? '—',
          email: u.email ?? '—',
          referralCode: u.referral_code?.trim() || null,
          orders: a.orders,
          spent: a.spent,
          joined: joinLabel(u.created_at),
          status: st,
          lastActive: lastBooking ? timeAgo(lastBooking) : joinLabel(u.created_at),
          lastActivityIso: displayLast || null,
        };
      });

      setCustomers(rows);
      setStats([rows.length, activeToday, newWeek]);
      setError(errs.length ? errs.slice(0, 2).join(' · ') : '');
    } catch (err) {
      setError(err?.message || 'Failed to load customers.');
      setCustomers([]);
      setStats([0, 0, 0]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete?.id || !isSupabaseConfigured || !supabase) {
      setDeleteErr(!supabase ? 'Database is not configured.' : 'No customer selected.');
      return;
    }
    setDeleteWorking(true);
    setDeleteErr('');
    const { data: deletedRows, error: delErr } = await supabase
      .from('app_users')
      .delete()
      .eq('id', pendingDelete.id)
      .select('id');
    setDeleteWorking(false);
    if (delErr) {
      const hint =
        /policy|permission|denied/i.test(delErr.message || '')
          ? ' Run the delete policy from supabase/register_login.sql (or supabase/app_users_delete_anon.sql) in the SQL editor.'
          : '';
      setDeleteErr((delErr.message || 'Delete failed.') + hint);
      return;
    }
    if (!deletedRows?.length) {
      setDeleteErr(
        'No row was deleted (blocked or not found). Run supabase/register_login.sql in the SQL editor so the app_users delete policy exists.',
      );
      return;
    }
    const removedId = pendingDelete.id;
    setPendingDelete(null);
    setSelectedCustomer((cur) => (cur?.id === removedId ? null : cur));
    setCustomers((prev) => prev.filter((c) => c.id !== removedId));
    setRecentByUserId((prev) => {
      const next = { ...prev };
      delete next[removedId];
      return next;
    });
    await load();
  };

  const filteredCustomers = useMemo(() => {
    let list = customers.filter((c) => {
      const matchSearch = customerMatchesQuery(c, search);
      const matchStatus = statusFilter === 'All' || c.status === statusFilter;
      return matchSearch && matchStatus;
    });

    if (sortBy === 'orders') {
      list = [...list].sort((a, b) => b.orders - a.orders);
    } else if (sortBy === 'spent') {
      list = [...list].sort((a, b) => b.spent - a.spent);
    } else {
      list = [...list].sort((a, b) => new Date(b.lastActivityIso || 0).getTime() - new Date(a.lastActivityIso || 0).getTime());
    }

    return list;
  }, [customers, search, sortBy, statusFilter]);

  const panelRecent = selectedCustomer ? recentByUserId[selectedCustomer.id] || [] : [];

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid3" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Total customers</p>
          <p className="v">{loading || !stats ? '…' : stats[0].toLocaleString()}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Activity today</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading || !stats ? '…' : stats[1].toLocaleString()}
          </p>
          <p className="admDim" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
            Customers with a booking today (local day)
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">New (last 7 days)</p>
          <p className="v">{loading || !stats ? '…' : stats[2].toLocaleString()}</p>
        </article>
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch admSearch--row">
            <input
              className="admSearchInput"
              type="search"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search customers by name, phone, or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, phone, email, or ID"
            />
            {search.trim() ? (
              <button type="button" className="admSearchClear" aria-label="Clear search" onClick={() => setSearch('')}>
                ×
              </button>
            ) : null}
          </div>
          <div className="admFilters admFilters--row">
            <select className="admSelect" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option>All</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
            <select className="admSelect" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="newest">Sort: Recent activity</option>
              <option value="orders">Sort: Total orders</option>
              <option value="spent">Sort: Total spent</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Phone Number</th>
                <th>Email</th>
                <th>Referral code</th>
                <th>Total Orders</th>
                <th>Total Spent</th>
                <th>Joined Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="admDim">
                    Loading customers…
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="admDim">
                    No customers found.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr
                    className="admClickableRow"
                    key={customer.id}
                    onClick={() => setSelectedCustomer(customer)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span className="admAvatar" style={{ width: 30, height: 30, fontSize: '0.7rem' }}>
                          {initials(customer.name)}
                        </span>
                        {customer.name}
                      </div>
                    </td>
                    <td>{customer.phone}</td>
                    <td>{customer.email}</td>
                    <td className="admDim">{customer.referralCode || '—'}</td>
                    <td>{customer.orders}</td>
                    <td style={{ color: '#0A58A6', fontWeight: 700 }}>{formatGBP(customer.spent)}</td>
                    <td>{customer.joined}</td>
                    <td>
                      <span className={statusClass(customer.status)}>{customer.status}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admActions">
                        <button type="button" aria-label="View profile" onClick={() => setSelectedCustomer(customer)}>
                          👁
                        </button>
                        <button
                          type="button"
                          aria-label="Delete customer"
                          style={{ color: '#d34444' }}
                          onClick={() => {
                            setPendingDelete({ id: customer.id, name: customer.name });
                            setDeleteErr('');
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={`admPanel${selectedCustomer ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Customer detail</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelectedCustomer(null)} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="admPanelBody">
          {selectedCustomer && (
            <>
              <div className="admPanelBlock" style={{ textAlign: 'center' }}>
                <span className="admAvatar" style={{ width: 64, height: 64, margin: '0 auto 0.45rem', fontSize: '1.1rem' }}>
                  {initials(selectedCustomer.name)}
                </span>
                <h3 style={{ margin: 0 }}>{selectedCustomer.name}</h3>
                <span className={statusClass(selectedCustomer.status)}>{selectedCustomer.status}</span>
                <p className="admDim" style={{ wordBreak: 'break-all', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                  User ID: {selectedCustomer.id}
                </p>
              </div>
              <div className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Contact</h4>
                <p style={{ marginBottom: '0.25rem' }}>{selectedCustomer.phone}</p>
                <p style={{ margin: 0 }}>{selectedCustomer.email}</p>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
                  <span className="admDim">Referral code:</span>{' '}
                  {selectedCustomer.referralCode ? (
                    <span className="admBadgeStatus admBlue">{selectedCustomer.referralCode}</span>
                  ) : (
                    <span className="admDim">None</span>
                  )}
                </p>
              </div>
              <div className="admGrid3" style={{ marginBottom: '0.8rem' }}>
                <div className="admPanelBlock">
                  <strong>{selectedCustomer.orders}</strong>
                  <p style={{ margin: 0, color: '#777' }}>Total orders</p>
                </div>
                <div className="admPanelBlock">
                  <strong>{formatGBP(selectedCustomer.spent)}</strong>
                  <p style={{ margin: 0, color: '#777' }}>Total spent</p>
                  <p className="admDim" style={{ fontSize: '0.72rem', marginBottom: 0 }}>
                    Non-cancelled amounts
                  </p>
                </div>
                <div className="admPanelBlock">
                  <strong>{selectedCustomer.lastActive}</strong>
                  <p style={{ margin: 0, color: '#777' }}>Last booking</p>
                </div>
              </div>
              <div className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Recent bookings</h4>
                {panelRecent.length === 0 ? (
                  <p className="admDim" style={{ margin: 0 }}>
                    No deliveries, rides or matched shop orders yet.
                  </p>
                ) : (
                  panelRecent.map((r, i) => (
                    <p key={`${r.line}-${i}`} style={{ margin: '0 0 0.42rem', fontSize: '0.86rem' }}>
                      {r.line}
                      <span className="admDim" style={{ display: 'block', fontSize: '0.75rem', marginTop: '0.1rem' }}>
                        {joinLabel(r.iso)}
                      </span>
                    </p>
                  ))
                )}
              </div>
              <section className="admPanelActions" style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #ebebeb' }}>
                <button
                  className="admDangerBtn"
                  type="button"
                  onClick={() => {
                    setPendingDelete({ id: selectedCustomer.id, name: selectedCustomer.name });
                    setDeleteErr('');
                  }}
                >
                  Delete customer
                </button>
              </section>
            </>
          )}
        </div>
      </aside>

      {pendingDelete ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-customer-delete-title">
          <button
            type="button"
            className="admModalBackdrop"
            aria-label="Close"
            onClick={() => !deleteWorking && setPendingDelete(null)}
          />
          <div className="admModalCard">
            <div className="admModalCardInner">
              <div className="admModalIconWrap" aria-hidden>
                🗑
              </div>
              <h2 id="adm-customer-delete-title" className="admModalTitle">
                Delete this customer?
              </h2>
              <p className="admModalText">
                This removes their <strong>{pendingDelete.name}</strong> login account from your database.
                Existing bookings usually keep historical rows but are no longer linked to this profile (set to guest).
              </p>
              {deleteErr ? (
                <p className="admModalErr" role="alert">
                  {deleteErr}
                </p>
              ) : null}
              <div className="admModalActions">
                <button type="button" className="admModalBtnGhost" disabled={deleteWorking} onClick={() => setPendingDelete(null)}>
                  Cancel
                </button>
                <button type="button" className="admModalBtnDanger" disabled={deleteWorking} onClick={() => confirmDelete()}>
                  {deleteWorking ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
