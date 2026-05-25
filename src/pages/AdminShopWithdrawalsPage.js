import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function statusClass(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'paid') return 'admBadgeStatus admGreen';
  if (v === 'approved') return 'admBadgeStatus admBlue';
  if (v === 'rejected') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admOrange';
}

export default function AdminShopWithdrawalsPage() {
  const [rows, setRows] = useState([]);
  const [shopMap, setShopMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setErr('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    const { data, error } = await supabase
      .from('shop_owner_withdrawal_requests')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) {
      setRows([]);
      setErr(error.message || 'Could not load requests.');
      setLoading(false);
      return;
    }
    const list = data || [];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.shop_owner_id).filter(Boolean))];
    if (ids.length) {
      const { data: shops } = await supabase
        .from('shop_owners')
        .select('id, business_name, email')
        .in('id', ids);
      const m = {};
      for (const s of shops || []) m[s.id] = s;
      setShopMap(m);
    } else {
      setShopMap({});
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const updateStatus = async (row, status) => {
    if (!isSupabaseConfigured || !supabase) return;
    setBusyId(row.id);
    const payload = { status };
    if (status === 'approved') payload.approved_at = new Date().toISOString();
    if (status === 'paid') payload.paid_at = new Date().toISOString();
    const { error } = await supabase
      .from('shop_owner_withdrawal_requests')
      .update(payload)
      .eq('id', row.id);
    setBusyId('');
    if (error) {
      setErr(error.message || 'Could not update request.');
      return;
    }
    await load();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = String(r.status || '').toLowerCase();
      const s = shopMap[r.shop_owner_id];
      const who = `${s?.business_name || ''} ${s?.email || ''}`.toLowerCase();
      const roleOk = statusFilter === 'All' || st === statusFilter.toLowerCase();
      const qOk =
        !q ||
        who.includes(q) ||
        String(r.id || '').toLowerCase().includes(q) ||
        String(r.shop_owner_id || '').toLowerCase().includes(q);
      return roleOk && qOk;
    });
  }, [rows, shopMap, search, statusFilter]);

  return (
    <div className="adm">
      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search shop, email, request..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="admFilters">
            <select className="admSelect" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option>All</option>
              <option>pending</option>
              <option>approved</option>
              <option>paid</option>
              <option>rejected</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admCard">
        {err ? (
          <p className="admDim" style={{ color: '#b42318', padding: '1rem' }}>
            {err}
          </p>
        ) : loading ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            Loading shop withdrawals…
          </p>
        ) : filtered.length === 0 ? (
          <p className="admDim" style={{ padding: '1rem' }}>
            No withdrawal requests found.
          </p>
        ) : (
          <div className="admTableWrap">
            <table className="admTable admWideTable">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Requested at</th>
                  <th>Approved at</th>
                  <th>Paid at</th>
                  <th className="admWdActionsHead">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const s = shopMap[r.shop_owner_id];
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{s?.business_name || 'Shop'}</div>
                        <div className="admDim" style={{ fontSize: '0.76rem' }}>
                          {s?.email || r.shop_owner_id}
                        </div>
                      </td>
                      <td style={{ fontWeight: 800 }}>�${Number(r.amount || 0).toFixed(2)}</td>
                      <td>
                        <span className={statusClass(r.status)}>{String(r.status || 'pending')}</span>
                      </td>
                      <td>{formatDt(r.requested_at)}</td>
                      <td>{formatDt(r.approved_at)}</td>
                      <td>{formatDt(r.paid_at)}</td>
                      <td className="admWdActionsCell">
                        <div className="admWdActions">
                          <button
                            type="button"
                            className="admWdBtn admWdBtn--paid"
                            disabled={busy || ['paid', 'rejected'].includes(String(r.status).toLowerCase())}
                            onClick={() => updateStatus(r, 'paid')}
                          >
                            Mark Paid
                          </button>
                          <button
                            type="button"
                            className="admWdBtn admWdBtn--reject"
                            disabled={busy || ['paid', 'rejected'].includes(String(r.status).toLowerCase())}
                            onClick={() => updateStatus(r, 'rejected')}
                          >
                            Reject
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
    </div>
  );
}
