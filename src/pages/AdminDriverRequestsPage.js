import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { formatVehicleTypeForDisplay } from '../lib/vehicleTypeDisplay';
import './adminPortal.css';

const TABS = ['All', 'Pending', 'Approved', 'Rejected'];

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function initials(name) {
  const n = String(name || '').trim();
  if (!n) return '—';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'admBadgeStatus admGreen';
  if (s === 'rejected') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admOrange';
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function IconTick() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCross() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function DocLink({ label, url }) {
  if (!url) return <span style={{ color: '#999' }}>{label}: —</span>;
  const href = String(url).trim();
  if (isHttpUrl(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
        {label}
      </a>
    );
  }
  return (
    <span title={href}>
      {label}: <code style={{ fontSize: '0.72rem' }}>{href.length > 48 ? `${href.slice(0, 48)}…` : href}</code>
    </span>
  );
}

export default function AdminDriverRequestsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [actionId, setActionId] = useState(null);
  const [actionErr, setActionErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from('driver_registrations')
      .select('*')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (qErr) {
      setError(qErr.message || 'Could not load driver requests.');
      setRows([]);
      return;
    }
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of rows) {
      const s = String(r.status || '').toLowerCase();
      if (s === 'pending') pending += 1;
      else if (s === 'approved') approved += 1;
      else if (s === 'rejected') rejected += 1;
    }
    return { pending, approved, rejected, total: rows.length };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = String(r.status || '').toLowerCase();
      const tabOk =
        activeTab === 'All' ||
        (activeTab === 'Pending' && st === 'pending') ||
        (activeTab === 'Approved' && st === 'approved') ||
        (activeTab === 'Rejected' && st === 'rejected');
      if (!tabOk) return false;
      if (!q) return true;
      const hay = [
        r.full_name,
        r.email,
        r.phone,
        r.vehicle_plate,
        r.vehicle_make,
        r.vehicle_model,
        r.national_id,
        r.referral_code,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, activeTab, search]);

  /**
   * @param {string} id
   * @param {'approved' | 'rejected'} status
   * @param {{ adminNotes?: string | null }} [options] — pass adminNotes for row actions; detail panel uses rejectNotes when omitted
   */
  const setStatus = async (id, status, options = {}) => {
    if (!supabase) return;
    setActionErr('');
    setActionId(id);
    try {
      const notesForReject =
        status === 'rejected'
          ? options.adminNotes !== undefined
            ? options.adminNotes
            : rejectNotes.trim() || null
          : null;
      const patch =
        status === 'rejected'
          ? { status, admin_notes: notesForReject }
          : { status };
      const { error: uErr } = await supabase.from('driver_registrations').update(patch).eq('id', id);
      if (uErr) {
        setActionErr(uErr.message || 'Update failed.');
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      setSelected((sel) => (sel?.id === id ? { ...sel, ...patch } : sel));
      if (status === 'rejected') setRejectNotes('');
    } finally {
      setActionId(null);
    }
  };

  const rejectFromRow = (id) => {
    if (!window.confirm('Reject this driver application?')) return;
    setStatus(id, 'rejected', { adminNotes: null });
  };

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Total</p>
          <p className="v">{counts.total}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Pending</p>
          <p className="v" style={{ color: '#ec9120' }}>
            {counts.pending}
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Approved</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {counts.approved}
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Rejected</p>
          <p className="v" style={{ color: '#d34444' }}>
            {counts.rejected}
          </p>
        </article>
      </section>

      {error ? (
        <p className="admCard" style={{ color: '#b42318', fontWeight: 600 }} role="alert">
          {error}
        </p>
      ) : null}

      <section className="admTabs">
        {TABS.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      {actionErr ? (
        <p className="admCard" style={{ color: '#b42318', fontWeight: 600, marginBottom: '0.65rem' }} role="alert">
          {actionErr}
        </p>
      ) : null}

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSearch">
          <input placeholder="Search name, email, phone, plate…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Name</th>
                <th>Email</th>
                <th>Referral code</th>
                <th>Phone</th>
                <th>Vehicle</th>
                <th>Plate</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '1.2rem', color: '#666' }}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '1.2rem', color: '#666' }}>
                    No registrations in this list.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="admClickableRow"
                    onClick={() => {
                      setSelected(r);
                      setRejectNotes('');
                      setActionErr('');
                    }}
                  >
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatDt(r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span className="admAvatar" style={{ width: 30, height: 30, fontSize: '0.7rem' }}>
                          {initials(r.full_name)}
                        </span>
                        {r.full_name}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{r.email}</td>
                    <td className="admDim">{r.referral_code || '—'}</td>
                    <td>
                      {r.phone_country_code ? `${r.phone_country_code} ` : ''}
                      {r.phone}
                    </td>
                    <td>
                      <span className="admBadgeStatus admBlue">
                        {formatVehicleTypeForDisplay(r.vehicle_type) || r.vehicle_type} · {r.vehicle_make} {r.vehicle_model}
                      </span>
                    </td>
                    <td>{r.vehicle_plate}</td>
                    <td>
                      <span className={statusBadgeClass(r.status)}>{String(r.status || '').replace(/^./, (c) => c.toUpperCase())}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {String(r.status || '').toLowerCase() === 'pending' ? (
                        <div className="admActions" style={{ gap: '0.25rem', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="admOutlineBtn"
                            style={{
                              padding: '0.25rem 0.4rem',
                              minWidth: '2rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderColor: '#0A58A6',
                              color: '#0A58A6',
                            }}
                            disabled={actionId === r.id}
                            aria-label={`Approve ${r.full_name}`}
                            onClick={() => setStatus(r.id, 'approved')}
                          >
                            {actionId === r.id ? <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>…</span> : <IconTick />}
                          </button>
                          <button
                            type="button"
                            className="admOutlineBtn"
                            style={{
                              padding: '0.25rem 0.4rem',
                              minWidth: '2rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderColor: '#d34444',
                              color: '#d34444',
                            }}
                            disabled={actionId === r.id}
                            aria-label={`Reject ${r.full_name}`}
                            onClick={() => rejectFromRow(r.id)}
                          >
                            {actionId === r.id ? <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>…</span> : <IconCross />}
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.78rem', color: '#999' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="admCard" style={{ marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: '0 0 0.35rem' }}>{selected.full_name}</h3>
              <p style={{ margin: 0, color: '#555', fontSize: '0.88rem' }}>
                {selected.email} · {selected.phone_country_code} {selected.phone}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#666' }}>
                National ID: {selected.national_id} · Submitted {formatDt(selected.created_at)}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                <strong>Referral code:</strong>{' '}
                {selected.referral_code ? (
                  <span className="admBadgeStatus admBlue">{selected.referral_code}</span>
                ) : (
                  <span style={{ color: '#999' }}>None</span>
                )}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                <strong>Vehicle:</strong> {formatVehicleTypeForDisplay(selected.vehicle_type) || selected.vehicle_type} —{' '}
                {selected.vehicle_make} {selected.vehicle_model},{' '}
                {selected.vehicle_color}, plate {selected.vehicle_plate}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                <strong>Deposit:</strong> {formatGBP(Number(selected.deposit_required_gbp) || 0)}{' '}
                {selected.deposit_paid ? '(marked paid)' : '(not paid)'}
              </p>
            </div>
            <button type="button" className="admOutlineBtn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>

          <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
            <strong style={{ width: '100%', fontSize: '0.82rem' }}>Documents</strong>
            <DocLink label="Profile" url={selected.profile_photo_url} />
            <span style={{ color: '#ccc' }}>|</span>
            <DocLink label="ID" url={selected.doc_national_id_url} />
            <span style={{ color: '#ccc' }}>|</span>
            <DocLink label="License" url={selected.doc_license_url} />
            <span style={{ color: '#ccc' }}>|</span>
            <DocLink label="V5" url={selected.doc_vehicle_registration_url} />
            <span style={{ color: '#ccc' }}>|</span>
            <DocLink label="With vehicle" url={selected.doc_profile_with_vehicle_url} />
          </div>

          {selected.admin_notes ? (
            <p style={{ margin: '0.65rem 0 0', fontSize: '0.82rem', color: '#555' }}>
              <strong>Admin notes:</strong> {selected.admin_notes}
            </p>
          ) : null}

          {String(selected.status || '').toLowerCase() === 'pending' ? (
            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #eee' }}>
              <div className="admField">
                <label htmlFor="drv-rej-notes">Rejection note (optional, saved with reject)</label>
                <textarea
                  id="drv-rej-notes"
                  className="admInput"
                  rows={2}
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="Reason shown internally only…"
                  style={{ resize: 'vertical' }}
                />
              </div>
              {actionErr ? (
                <p style={{ color: '#b42318', fontSize: '0.8rem', fontWeight: 600 }} role="alert">
                  {actionErr}
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="admBtn"
                  style={{
                    width: 'auto',
                    minWidth: '2.5rem',
                    background: '#0A58A6',
                    padding: '0.5rem 0.75rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  disabled={actionId === selected.id}
                  aria-label="Approve application"
                  title="Approve"
                  onClick={() => setStatus(selected.id, 'approved')}
                >
                  {actionId === selected.id ? <span style={{ fontSize: '0.9rem' }}>…</span> : <IconTick />}
                </button>
                <button
                  type="button"
                  className="admOutlineBtn"
                  style={{
                    borderColor: '#d34444',
                    color: '#d34444',
                    minWidth: '2.5rem',
                    padding: '0.5rem 0.75rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  disabled={actionId === selected.id}
                  aria-label="Reject application"
                  title="Reject"
                  onClick={() => setStatus(selected.id, 'rejected')}
                >
                  {actionId === selected.id ? <span style={{ fontSize: '0.9rem' }}>…</span> : <IconCross />}
                </button>
              </div>
            </div>
          ) : (
            <p style={{ marginTop: '0.85rem', fontSize: '0.85rem', color: '#666' }}>
              This application is <strong>{selected.status}</strong>. No further action from this screen.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
