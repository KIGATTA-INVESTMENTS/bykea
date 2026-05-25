import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderOutlineBtn, AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const tabs = ['All', 'Requested', 'Confirmed', 'Completed', 'Cancelled'];

function shortBookingRef(id) {
  if (!id) return '—';
  const short = String(id).replace(/-/g, '').slice(0, 10).toUpperCase();
  return `TXI-${short}`;
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

function rideTypeLabel(key) {
  const k = String(key || '').toLowerCase();
  if (k === 'tuk') return 'Tuk-Tuk';
  if (k === 'std') return 'Standard';
  if (k === 'prem') return 'Premium';
  return key || '—';
}

function taxiBookingVehicleLabel(row) {
  if (row?._sourceTable === 'tuk_tuk_bookings') return 'Tuk-Tuk';
  const rt = String(row?.ride_type || '').toLowerCase();
  if (rt === 'prem') return 'Premium';
  if (rt === 'tuk') return 'Tuk-Tuk';
  const vt = String(row?.vehicle_type || '').toLowerCase();
  if (vt === 'bicycle') return 'Bike';
  if (vt === 'tuktuk') return 'Tuk-Tuk';
  if (vt === 'car') return 'Car';
  if (vt === 'minibus') return 'Mini Bus';
  return rideTypeLabel(row?.ride_type);
}

function bookingFlowLabel(row) {
  return row?._sourceTable === 'tuk_tuk_bookings' ? 'Tuk-Tuk page' : 'Book ride';
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

export default function AdminTaxiBookingsPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [rideFilter, setRideFilter] = useState('All');
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

    const fetchTaxi = async () => {
      let q = await supabase.from('taxi_bookings').select(userSelect).order('created_at', { ascending: false });
      if (q.error && /relationship|schema cache/i.test(q.error.message || '')) {
        q = await supabase.from('taxi_bookings').select('*').order('created_at', { ascending: false });
      }
      return q;
    };

    const fetchTuk = async () => {
      let q = await supabase.from('tuk_tuk_bookings').select(userSelect).order('created_at', { ascending: false });
      if (q.error && /relationship|schema cache/i.test(q.error.message || '')) {
        q = await supabase.from('tuk_tuk_bookings').select('*').order('created_at', { ascending: false });
      }
      return q;
    };

    const [taxiRes, tukRes] = await Promise.all([fetchTaxi(), fetchTuk()]);

    const taxiRows = (taxiRes.data || []).map((r) => ({ ...r, _sourceTable: 'taxi_bookings' }));
    const tukRows = (tukRes.data || []).map((r) => ({
      ...r,
      _sourceTable: 'tuk_tuk_bookings',
    }));

    const merged = [...taxiRows, ...tukRows].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

    setRows(merged);
    if (!merged.length) {
      const msg = [taxiRes.error?.message, tukRes.error?.message].filter(Boolean).join(' · ');
      setError(msg || '');
    } else {
      setError('');
    }
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
    const table = pendingDelete._sourceTable === 'tuk_tuk_bookings' ? 'tuk_tuk_bookings' : 'taxi_bookings';
    const { error: delErr } = await supabase.from(table).delete().eq('id', pendingDelete.id);
    setDeleteWorking(false);
    if (delErr) {
      setDeleteErr(
        delErr.message || `Could not delete booking. Ensure DELETE policy exists on ${table}.`,
      );
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
    const cancelled = rows.filter((r) => String(r.status || '').toLowerCase() === 'cancelled').length;
    const guests = rows.filter((r) => !resolveUser(r)).length;
    return { total, requested, confirmed, completed, cancelled, guests };
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

      const label = taxiBookingVehicleLabel(row);
      let matchRide = false;
      if (rideFilter === 'All') matchRide = true;
      else if (rideFilter === 'Tuk-Tuk page') matchRide = row._sourceTable === 'tuk_tuk_bookings';
      else matchRide = label === rideFilter;

      return matchQ && matchTab && matchRide;
    });
  }, [activeTab, rideFilter, rows, search]);

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
            defaultValue="All types · /book-ride + /book-tuk-tuk"
            title="Merges taxi_bookings and tuk_tuk_bookings (all statuses)"
          />
        </div>
      </div>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
          <p className="admDim" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Run <code style={{ fontSize: '0.82rem' }}>taxi_bookings.sql</code> and{' '}
            <code style={{ fontSize: '0.82rem' }}>tuk_tuk_bookings.sql</code> in your SQL editor if tables are missing.
          </p>
        </div>
      ) : null}

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Total bookings</h4>
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
          <div className="admFilters">
            <select className="admSelect" value={rideFilter} onChange={(event) => setRideFilter(event.target.value)}>
              <option>All</option>
              <option>Tuk-Tuk page</option>
              <option>Bike</option>
              <option>Tuk-Tuk</option>
              <option>Car</option>
              <option>Mini Bus</option>
              <option>Standard</option>
              <option>Premium</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admCard">
        {loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading taxi bookings…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem', margin: 0 }}>
            No bookings match your filters. This list merges <strong>/book-ride</strong> (<code>taxi_bookings</code>) and{' '}
            <strong>/book-tuk-tuk</strong> (<code>tuk_tuk_bookings</code>) — all ride types and statuses.
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable admWideTable">
              <thead>
                <tr>
                  <th>Booking ID</th>
                  <th>Flow</th>
                  <th>Ride type</th>
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
                    <tr key={`${row._sourceTable}-${row.id}`} className="admClickableRow" onClick={() => setSelected(row)}>
                      <td>
                        <button className="admLink" type="button">
                          {shortBookingRef(row.id)}
                        </button>
                      </td>
                      <td className="admDim" style={{ fontSize: '0.85rem' }}>
                        {bookingFlowLabel(row)}
                      </td>
                      <td>
                        <span className="admBadgeStatus admBlue">{taxiBookingVehicleLabel(row)}</span>
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
          <strong>Booking detail</strong>
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
                  <span className="admBadgeStatus admBlue">{bookingFlowLabel(sel)}</span>
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
                <h4 style={{ marginTop: 0 }}>Ride</h4>
                <p style={{ margin: '0.2rem 0' }}>
                  Type: <strong>{taxiBookingVehicleLabel(sel)}</strong>
                </p>
                <p style={{ margin: '0.2rem 0' }}>Fare at booking: {formatGBP(sel.quoted_price)}</p>
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
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-taxi-delete-title">
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
              <h2 id="adm-taxi-delete-title" className="admModalTitle">
                Delete this booking?
              </h2>
              <p className="admModalText">
                This permanently removes the row from your database.
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
