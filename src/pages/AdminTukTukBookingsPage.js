import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderOutlineBtn, AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const tabs = ['All', 'Requested', 'Confirmed', 'Completed', 'Cancelled'];

function shortBookingRef(id) {
  if (!id) return '—';
  const short = String(id).replace(/-/g, '').slice(0, 10).toUpperCase();
  return `TTK-${short}`;
}

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function resolveUser(row) {
  const user = row.app_users;
  if (user && !Array.isArray(user)) return user;
  if (Array.isArray(user) && user[0]) return user[0];
  return null;
}

function customerDisplayName(row) {
  const u = resolveUser(row);
  return u?.full_name?.trim() || 'Guest';
}

function initials(name) {
  const n = String(name || '').trim();
  if (!n || n === 'Guest') return 'GU';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'admBadgeStatus admGreen';
  if (s === 'cancelled') return 'admBadgeStatus admRed';
  if (s === 'confirmed') return 'admBadgeStatus admBlue';
  return 'admBadgeStatus admOrange';
}

export default function AdminTukTukBookingsPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);

    const userSelect = `
        *,
        app_users (
          id,
          full_name,
          phone,
          email,
          created_at
        )
      `;

    let query = supabase.from('tuk_tuk_bookings').select(userSelect).order('created_at', { ascending: false });
    let { data, error: qErr } = await query;

    if (qErr && /relationship|schema cache/i.test(qErr.message || '')) {
      const fallback = await supabase.from('tuk_tuk_bookings').select('*').order('created_at', { ascending: false });
      data = fallback.data;
      qErr = fallback.error;
    }

    if (qErr) {
      setRows([]);
      setError(qErr.message);
      setLoading(false);
      return;
    }

    setRows(Array.isArray(data) ? data : []);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !deleteWorking) setPendingDelete(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDelete, deleteWorking]);

  const confirmDelete = async () => {
    if (!pendingDelete?.id || !isSupabaseConfigured || !supabase) {
      setDeleteErr(!supabase ? 'Database is not configured.' : 'No booking selected.');
      return;
    }
    setDeleteWorking(true);
    setDeleteErr('');
    const { error: delErr } = await supabase.from('tuk_tuk_bookings').delete().eq('id', pendingDelete.id);
    setDeleteWorking(false);
    if (delErr) {
      setDeleteErr(delErr.message || 'Could not delete booking. Ensure DELETE policy exists on tuk_tuk_bookings.');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== pendingDelete.id));
    if (selected?.id === pendingDelete.id) setSelected(null);
    setPendingDelete(null);
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const requested = rows.filter((r) => String(r.status || '').toLowerCase() === 'requested').length;
    const confirmed = rows.filter((r) => String(r.status || '').toLowerCase() === 'confirmed').length;
    const completed = rows.filter((r) => String(r.status || '').toLowerCase() === 'completed').length;
    const guests = rows.filter((r) => !resolveUser(r)).length;
    return { total, requested, confirmed, completed, guests };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((row) => {
      const ref = shortBookingRef(row.id).toLowerCase();
      const name = customerDisplayName(row).toLowerCase();
      const u = resolveUser(row);
      const email = (u?.email || '').toLowerCase();
      const phone = (u?.phone || '').toLowerCase();
      const pickup = (row.pickup_location || '').toLowerCase();
      const dest = (row.destination_location || '').toLowerCase();
      const matchQ =
        !q ||
        ref.includes(q) ||
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        pickup.includes(q) ||
        dest.includes(q);

      const st = String(row.status || '').toLowerCase();
      const matchTab = activeTab === 'All' || st === activeTab.toLowerCase();

      return matchQ && matchTab;
    });
  }, [activeTab, rows, search]);

  const sel = selected;
  const selUser = sel ? resolveUser(sel) : null;
  const selName = sel ? customerDisplayName(sel) : '';

  useSetAdminHeaderActions(
    <>
      <AdminHeaderOutlineBtn type="button">Export</AdminHeaderOutlineBtn>
      <AdminHeaderRefresh onClick={() => load()} disabled={loading} />
    </>,
    [loading, load],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <div className="admFilters">
          <input
            className="admInput admDateInput"
            readOnly
            defaultValue="Live data · tuk_tuk_bookings"
            title="Live data from tuk_tuk_bookings"
          />
        </div>
      </div>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
          <p className="admDim" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Run <code style={{ fontSize: '0.82rem' }}>tuk_tuk_bookings.sql</code> in your SQL editor if the table is missing.
          </p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Total Tuk-Tuk bookings</h4>
          <p className="v">{loading ? '…' : stats.total}</p>
          <p className="s" style={{ color: '#0A58A6' }}>
            All statuses
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#ec9120' }}>
          <h4>Requested</h4>
          <p className="v" style={{ color: '#ec9120' }}>
            {loading ? '…' : stats.requested}
          </p>
          <p className="s" style={{ color: '#ec9120' }}>
            Awaiting assignment
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Confirmed / completed</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : stats.confirmed + stats.completed}
          </p>
          <p className="s" style={{ color: '#0A58A6' }}>
            In progress or done
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#9aa899' }}>
          <h4>Guest bookings</h4>
          <p className="v" style={{ color: '#5c665c' }}>
            {loading ? '…' : stats.guests}
          </p>
          <p className="s" style={{ color: '#7a847a' }}>
            No linked app_users row
          </p>
        </article>
      </section>

      <section className="admTabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search booking ID, customer, email, route..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="admCard">
        {loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading Tuk-Tuk bookings…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem', margin: 0 }}>
            No bookings yet. Customer bookings from <strong>/book-tuk-tuk</strong> are saved here.
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable admWideTable">
              <thead>
                <tr>
                  <th>Booking ID</th>
                  <th>Customer</th>
                  <th>Pickup</th>
                  <th>Destination</th>
                  <th>Fare</th>
                  <th>Estimate</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const name = customerDisplayName(row);
                  const ini = initials(name);
                  return (
                    <tr key={row.id} className="admClickableRow" onClick={() => setSelected(row)}>
                      <td>
                        <button className="admLink" type="button">
                          {shortBookingRef(row.id)}
                        </button>
                      </td>
                      <td>
                        <div className="admInlineUser">
                          <span className="admMiniAvatar">{ini}</span>
                          {name}
                        </div>
                      </td>
                      <td className="admDim">{row.pickup_location ?? '—'}</td>
                      <td className="admDim">{row.destination_location ?? '—'}</td>
                      <td style={{ fontWeight: 700 }}>{formatGBP(row.quoted_price)}</td>
                      <td className="admDim">
                        {[row.estimated_distance_label, row.estimated_duration_label].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="admDim">{formatDt(row.created_at)}</td>
                      <td>
                        <span className={statusBadgeClass(row.status)}>{row.status ?? '—'}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="admActions">
                          <button type="button" aria-label="View details" onClick={() => setSelected(row)}>
                            👁
                          </button>
                          <button
                            type="button"
                            aria-label="Delete booking"
                            style={{ color: '#d34444' }}
                            onClick={() => {
                              setPendingDelete(row);
                              setDeleteErr('');
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className={`admPanel${selected ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Tuk-Tuk booking</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelected(null)} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="admPanelBody">
          {sel && (
            <>
              <section className="admPanelBlock">
                <div className="admSectionHeader" style={{ marginBottom: '0.2rem' }}>
                  <h3 style={{ margin: 0 }}>{shortBookingRef(sel.id)}</h3>
                  <span className="admBadgeStatus admBlue">Tuk-Tuk</span>
                </div>
                <span className={statusBadgeClass(sel.status)} style={{ fontSize: '0.78rem' }}>
                  {sel.status ?? '—'}
                </span>
                <p className="admDim" style={{ marginBottom: 0 }}>
                  {formatDt(sel.created_at)}
                </p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Customer</h4>
                <div className="admInlineUser">
                  <span className="admMiniAvatar">{initials(selName)}</span>
                  <strong>{selName}</strong>
                </div>
                <p className="admDim">{selUser?.phone ?? '—'}</p>
                <p className="admDim">{selUser?.email ?? '—'}</p>
                {selUser?.id ? (
                  <p className="admDim" style={{ wordBreak: 'break-all' }}>
                    User ID: {selUser.id}
                  </p>
                ) : (
                  <p className="admUnassigned">Guest — booked without logged-in profile ID</p>
                )}
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Fare</h4>
                <p style={{ margin: '0.2rem 0' }}>Quoted at booking: {formatGBP(sel.quoted_price)}</p>
                <p className="admDim">
                  Currency: {sel.currency ?? 'USD'} · Distance label: {sel.estimated_distance_label ?? '—'} · Duration:{' '}
                  {sel.estimated_duration_label ?? '—'}
                </p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Route</h4>
                <div className="admMapMock">Map preview</div>
                <p style={{ margin: '0.4rem 0 0.2rem' }}>
                  <span className="admDotGreen" /> {sel.pickup_location ?? '—'}
                </p>
                <p className="admDashLine">- - - - - - - - -</p>
                <p style={{ margin: '0.2rem 0' }}>
                  <span className="admDotRed" /> {sel.destination_location ?? '—'}
                </p>
              </section>

              <section className="admPanelActions">
                <button className="admDangerBtn" type="button" onClick={() => { setPendingDelete(sel); setDeleteErr(''); }}>
                  Delete booking
                </button>
              </section>
            </>
          )}
        </div>
      </aside>

      {pendingDelete ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-tuktuk-delete-title">
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
              <h2 id="adm-tuktuk-delete-title" className="admModalTitle">
                Delete this Tuk-Tuk booking?
              </h2>
              <p className="admModalText">
                This permanently removes the row from <code>tuk_tuk_bookings</code>.
                <span className="admModalOrderTag">{shortBookingRef(pendingDelete.id)}</span>
              </p>
              {deleteErr ? (
                <p className="admModalErr" role="alert">
                  {deleteErr}
                </p>
              ) : null}
              <div className="admModalActions">
                <button type="button" className="admModalBtnGhost" disabled={deleteWorking} onClick={() => setPendingDelete(null)}>
                  Keep
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
