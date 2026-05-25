import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { isDriverDepositSatisfied } from '../lib/driverDepositGate';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { formatVehicleTypeForDisplay } from '../lib/vehicleTypeDisplay';
import { PARCEL_DRIVER_VEHICLE_TYPES } from '../lib/deliveryVehicleTypes';
import './adminPortal.css';

const VEHICLE_TYPES = [...PARCEL_DRIVER_VEHICLE_TYPES];
const PHONE_CODES = ['+44', '+1', '+971'];

function formatDt(iso) {
  if (!iso) return '�';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function initials(name) {
  const n = String(name || '').trim();
  if (!n) return '�';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function DocLink({ label, url }) {
  if (!url) return <span style={{ color: '#999' }}>{label}: �</span>;
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
      {label}: <code style={{ fontSize: '0.72rem' }}>{href.length > 48 ? `${href.slice(0, 48)}�` : href}</code>
    </span>
  );
}

function IconView() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path
        d="M4 7h16M6.5 7V18a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V7M9.5 10.5V16M12.5 10.5V16M8.5 4.5h7l.5 1.5H8Z"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function rowToEditForm(r) {
  const cc = r.phone_country_code ?? '+44';
  return {
    full_name: r.full_name ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    phone_country_code: PHONE_CODES.includes(cc) ? cc : '+44',
    national_id: r.national_id ?? '',
    vehicle_type: VEHICLE_TYPES.includes(r.vehicle_type) ? r.vehicle_type : 'Motorbike',
    vehicle_make: r.vehicle_make ?? '',
    vehicle_model: r.vehicle_model ?? '',
    vehicle_plate: r.vehicle_plate ?? '',
    vehicle_color: r.vehicle_color ?? '',
    newPassword: '',
  };
}

export default function AdminOurDriversPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [viewDriver, setViewDriver] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editErr, setEditErr] = useState('');
  const [saveWorking, setSaveWorking] = useState(false);
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
    const { data, error: qErr } = await supabase
      .from('driver_registrations')
      .select('*')
      .eq('status', 'approved')
      .order('updated_at', { ascending: false });
    setLoading(false);
    if (qErr) {
      setError(qErr.message || 'Could not load drivers.');
      setRows([]);
      return;
    }
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!viewDriver && !editRow && !pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (deleteWorking || saveWorking) return;
      setViewDriver(null);
      setEditRow(null);
      setEditForm(null);
      setPendingDelete(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewDriver, editRow, pendingDelete, deleteWorking, saveWorking]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.full_name, r.email, r.phone, r.vehicle_plate, r.national_id, r.vehicle_make, r.vehicle_model]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const openViewDriver = useCallback(async (r) => {
    setViewDriver(r);
    if (!isSupabaseConfigured || !supabase || !r?.id) return;
    const { data } = await supabase.from('driver_registrations').select('*').eq('id', r.id).maybeSingle();
    if (data) {
      setViewDriver(data);
      setRows((prev) => prev.map((x) => (x.id === data.id ? data : x)));
    }
  }, []);

  const openEdit = (r) => {
    setEditErr('');
    setEditRow(r);
    setEditForm(rowToEditForm(r));
  };

  const saveEdit = async () => {
    if (!editRow?.id || !editForm || !isSupabaseConfigured || !supabase) return;
    setSaveWorking(true);
    setEditErr('');
    const emailNorm = String(editForm.email || '').trim().toLowerCase();
    const payload = {
      full_name: String(editForm.full_name || '').trim(),
      email: emailNorm,
      phone: String(editForm.phone || '').trim(),
      phone_country_code: editForm.phone_country_code || '+44',
      national_id: String(editForm.national_id || '').trim(),
      vehicle_type: editForm.vehicle_type,
      vehicle_make: String(editForm.vehicle_make || '').trim(),
      vehicle_model: String(editForm.vehicle_model || '').trim(),
      vehicle_plate: String(editForm.vehicle_plate || '').trim(),
      vehicle_color: String(editForm.vehicle_color || '').trim(),
    };
    if (!payload.full_name || !payload.email || !payload.phone || !payload.national_id) {
      setEditErr('Name, email, phone, and national ID are required.');
      setSaveWorking(false);
      return;
    }
    const pw = String(editForm.newPassword || '').trim();
    if (pw) payload.password = pw;

    const { data: updated, error: uErr } = await supabase
      .from('driver_registrations')
      .update(payload)
      .eq('id', editRow.id)
      .select('*')
      .maybeSingle();

    setSaveWorking(false);
    if (uErr) {
      setEditErr(uErr.message || 'Could not save changes.');
      return;
    }
    if (updated) {
      setRows((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    }
    setEditRow(null);
    setEditForm(null);
    if (viewDriver?.id === editRow.id) setViewDriver(updated || null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete?.id || !isSupabaseConfigured || !supabase) {
      setDeleteErr(!supabase ? 'Database is not configured.' : 'No driver selected.');
      return;
    }
    setDeleteWorking(true);
    setDeleteErr('');
    const { error: dErr } = await supabase.from('driver_registrations').delete().eq('id', pendingDelete.id);
    setDeleteWorking(false);
    if (dErr) {
      setDeleteErr(dErr.message || 'Could not delete. Check RLS/policies on driver_registrations.');
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== pendingDelete.id));
    if (viewDriver?.id === pendingDelete.id) setViewDriver(null);
    if (editRow?.id === pendingDelete.id) {
      setEditRow(null);
      setEditForm(null);
    }
    setPendingDelete(null);
  };

  const v = viewDriver;
  const ef = editForm;
  const depositPaid = v ? isDriverDepositSatisfied(v) : false;
  const depositRequired = v ? Number(v.deposit_required_gbp ?? 10) : 10;
  const depositBalance = v ? Number(v.driver_deposit_balance_gbp ?? 0) : 0;

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', maxWidth: '42rem' }}>
        Drivers listed here have an <strong>approved</strong> registration. They are the only accounts that can sign in to the driver app.
      </p>

      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Approved drivers</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {rows.length}
          </p>
        </article>
      </section>

      {error ? (
        <p className="admCard" style={{ color: '#b42318', fontWeight: 600 }} role="alert">
          {error}
        </p>
      ) : null}

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSearch">
          <input placeholder="Search name, email, phone, plate�" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Vehicle</th>
                <th>Plate</th>
                <th>Approved / updated</th>
                <th style={{ width: '7.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '1.2rem', color: '#666' }}>
                    Loading�
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '1.2rem', color: '#666' }}>
                    No approved drivers yet. Approve applications from <strong>Driver requests</strong>.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span className="admAvatar" style={{ width: 30, height: 30, fontSize: '0.7rem' }}>
                          {initials(r.full_name)}
                        </span>
                        {r.full_name}
                      </div>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{r.email}</td>
                    <td>
                      {r.phone_country_code ? `${r.phone_country_code} ` : ''}
                      {r.phone}
                    </td>
                    <td>
                      <span className="admBadgeStatus admBlue">
                        {formatVehicleTypeForDisplay(r.vehicle_type) || r.vehicle_type} � {r.vehicle_make} {r.vehicle_model}
                      </span>
                    </td>
                    <td>{r.vehicle_plate}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{formatDt(r.updated_at || r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="admShopOrdIcon admShopOrdIcon--view"
                          aria-label={`View ${r.full_name}`}
                          onClick={() => openViewDriver(r)}
                        >
                          <IconView />
                        </button>
                        <button
                          type="button"
                          className="admShopOrdIcon admShopOrdIcon--edit"
                          aria-label={`Edit ${r.full_name}`}
                          onClick={() => openEdit(r)}
                        >
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          className="admShopOrdIcon admShopOrdIcon--del"
                          aria-label={`Delete ${r.full_name}`}
                          onClick={() => {
                            setPendingDelete({ id: r.id, full_name: r.full_name, email: r.email });
                            setDeleteErr('');
                          }}
                        >
                          <IconTrash />
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

      {v ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-od-view-title">
          <button type="button" className="admModalBackdrop" aria-label="Close" onClick={() => setViewDriver(null)} />
          <div className="admModalCard" style={{ maxWidth: '26rem', width: '100%' }}>
            <div className="admModalCardInner" style={{ textAlign: 'left' }}>
              <h2 id="adm-od-view-title" className="admModalTitle" style={{ textAlign: 'left' }}>
                {v.full_name}
              </h2>
              <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.82rem' }}>
                Approved driver � {formatDt(v.updated_at || v.created_at)}
              </p>
              <p style={{ margin: '0 0 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Contact</p>
              <p style={{ margin: 0, fontSize: '0.88rem' }}>
                <strong>Email</strong> {v.email}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
                <strong>Phone</strong> {v.phone_country_code} {v.phone}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
                <strong>National ID</strong> {v.national_id}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
                <strong>Password</strong> <span className="admDim">(stored value hidden)</span>
              </p>

              <p style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Vehicle</p>
              <p style={{ margin: 0, fontSize: '0.88rem' }}>
                {formatVehicleTypeForDisplay(v.vehicle_type) || v.vehicle_type} � {v.vehicle_make} {v.vehicle_model}
              </p>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.88rem' }}>
                Plate {v.vehicle_plate} � {v.vehicle_color}
              </p>

              <p style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Deposit</p>
              <p style={{ margin: 0, fontSize: '0.88rem' }}>
                ${depositRequired.toFixed(2)} required ·{' '}
                <span style={{ color: depositPaid ? '#166534' : '#b42318', fontWeight: 700 }}>
                  {depositPaid ? 'Paid' : 'Not paid'}
                </span>
              </p>
              {depositBalance > 0 ? (
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#555' }}>
                  Current balance: ${depositBalance.toFixed(2)}
                </p>
              ) : null}

              {v.admin_notes ? (
                <>
                  <p style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Admin notes</p>
                  <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.45 }}>{v.admin_notes}</p>
                </>
              ) : null}

              <p style={{ margin: '0.85rem 0 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Documents</p>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.84rem' }}>
                <li style={{ marginBottom: 6 }}>
                  <DocLink label="National ID" url={v.doc_national_id_url} />
                </li>
                <li style={{ marginBottom: 6 }}>
                  <DocLink label="License" url={v.doc_license_url} />
                </li>
                <li style={{ marginBottom: 6 }}>
                  <DocLink label="Vehicle registration" url={v.doc_vehicle_registration_url} />
                </li>
                <li>
                  <DocLink label="Profile with vehicle" url={v.doc_profile_with_vehicle_url} />
                </li>
              </ul>

              <p className="admDim" style={{ margin: '0.75rem 0 0', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                Row id: {v.id}
              </p>

              <div className="admModalActions" style={{ marginTop: '1rem' }}>
                <button type="button" className="admModalBtnGhost" onClick={() => setViewDriver(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="admOutlineBtn"
                  onClick={() => {
                    setViewDriver(null);
                    openEdit(v);
                  }}
                >
                  Edit driver
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {ef && editRow ? (
        <div className="admModalRoot admModalRoot--overscrollSafe" role="dialog" aria-modal="true" aria-labelledby="adm-od-edit-title">
          <button
            type="button"
            className="admModalBackdrop"
            aria-label="Close"
            onClick={() => {
              if (!saveWorking) {
                setEditRow(null);
                setEditForm(null);
              }
            }}
          />
          <div className="admModalCard admModalCard--scrollForm" style={{ width: '100%' }}>
            <div className="admModalScrollFormBody">
              <h2 id="adm-od-edit-title" className="admModalTitle">
                Edit {editRow.full_name}
              </h2>
              <div className="admField" style={{ marginTop: '0.65rem' }}>
                <label htmlFor="od-edit-name">Full name</label>
                <input
                  id="od-edit-name"
                  className="admInput"
                  value={ef.full_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div className="admField">
                <label htmlFor="od-edit-email">Email</label>
                <input
                  id="od-edit-email"
                  className="admInput"
                  type="email"
                  autoComplete="off"
                  value={ef.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="admField" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 6rem', minWidth: '5rem' }}>
                  <label htmlFor="od-edit-cc">Code</label>
                  <select
                    id="od-edit-cc"
                    className="admInput"
                    value={ef.phone_country_code}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone_country_code: e.target.value }))}
                  >
                    {PHONE_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 12rem', minWidth: '8rem' }}>
                  <label htmlFor="od-edit-phone">Phone</label>
                  <input
                    id="od-edit-phone"
                    className="admInput"
                    type="tel"
                    autoComplete="tel-national"
                    inputMode="tel"
                    placeholder="Digits only recommended"
                    value={ef.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="admField">
                <label htmlFor="od-edit-nid">National ID</label>
                <input
                  id="od-edit-nid"
                  className="admInput"
                  value={ef.national_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, national_id: e.target.value }))}
                />
              </div>
              <div className="admField">
                <label htmlFor="od-edit-vtype">Vehicle type</label>
                <select
                  id="od-edit-vtype"
                  className="admInput"
                  value={ef.vehicle_type}
                  onChange={(e) => setEditForm((f) => ({ ...f, vehicle_type: e.target.value }))}
                >
                  {VEHICLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {formatVehicleTypeForDisplay(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admField">
                <label htmlFor="od-edit-vmake">Make / model</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    id="od-edit-vmake"
                    className="admInput"
                    placeholder="Make"
                    value={ef.vehicle_make}
                    onChange={(e) => setEditForm((f) => ({ ...f, vehicle_make: e.target.value }))}
                    style={{ flex: '1 1 8rem', minWidth: '6rem' }}
                  />
                  <input
                    id="od-edit-vmodel"
                    className="admInput"
                    placeholder="Model"
                    value={ef.vehicle_model}
                    onChange={(e) => setEditForm((f) => ({ ...f, vehicle_model: e.target.value }))}
                    style={{ flex: '1 1 8rem', minWidth: '6rem' }}
                  />
                </div>
              </div>
              <div className="admField">
                <label htmlFor="od-edit-plate">Plate / color</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    id="od-edit-plate"
                    className="admInput"
                    placeholder="Plate"
                    value={ef.vehicle_plate}
                    onChange={(e) => setEditForm((f) => ({ ...f, vehicle_plate: e.target.value }))}
                    style={{ flex: '1 1 8rem', minWidth: '6rem' }}
                  />
                  <input
                    id="od-edit-color"
                    className="admInput"
                    placeholder="Color"
                    value={ef.vehicle_color}
                    onChange={(e) => setEditForm((f) => ({ ...f, vehicle_color: e.target.value }))}
                    style={{ flex: '1 1 8rem', minWidth: '6rem' }}
                  />
                </div>
              </div>
              <div className="admField">
                <label htmlFor="od-edit-pw">New password</label>
                <input
                  id="od-edit-pw"
                  className="admInput"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leave blank to keep current"
                  value={ef.newPassword}
                  onChange={(e) => setEditForm((f) => ({ ...f, newPassword: e.target.value }))}
                />
              </div>
              {editErr ? (
                <p className="admModalErr" role="alert" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                  {editErr}
                </p>
              ) : null}
            </div>
            <div className="admModalFormFooter">
              <div className="admModalActions">
                <button
                  type="button"
                  className="admModalBtnGhost"
                  disabled={saveWorking}
                  onClick={() => {
                    setEditRow(null);
                    setEditForm(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="admInfoBtn" disabled={saveWorking} onClick={() => saveEdit()}>
                  {saveWorking ? 'Saving�' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-od-del-title">
          <button
            type="button"
            className="admModalBackdrop"
            aria-label="Close"
            onClick={() => !deleteWorking && setPendingDelete(null)}
          />
          <div className="admModalCard">
            <div className="admModalCardInner">
              <div className="admModalIconWrap" aria-hidden>
                ??
              </div>
              <h2 id="adm-od-del-title" className="admModalTitle">
                Delete this driver record?
              </h2>
              <p className="admModalText">
                This removes <strong>{pendingDelete.full_name}</strong> ({pendingDelete.email}) from the database. They will no longer be able to sign in. You cannot undo this.
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
                  {deleteWorking ? 'Deleting�' : 'Yes, delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
