import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { adminCreditCustomerWallet } from '../lib/customerWallet';
import {
  fetchAdminRiderWalletPayoutJobs,
  markRiderWalletJobPaid,
} from '../lib/adminRiderWalletPayouts';
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
  if (v === 'paid' || v === 'credit') return 'admBadgeStatus admGreen';
  if (v === 'debit' || v === 'pending') return 'admBadgeStatus admOrange';
  return 'admBadgeStatus admGray';
}

export default function AdminWalletsPage() {
  const [tab, setTab] = useState('customers');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // —— Customer wallets ——
  const [customers, setCustomers] = useState([]);
  const [wallets, setWallets] = useState({});
  const [txRows, setTxRows] = useState([]);
  const [custLoading, setCustLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditSource, setCreditSource] = useState('cash');
  const [creditNote, setCreditNote] = useState('');
  const [crediting, setCrediting] = useState(false);

  // —— Rider payouts ——
  const [payoutJobs, setPayoutJobs] = useState([]);
  const [driverMap, setDriverMap] = useState({});
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutFilter, setPayoutFilter] = useState('All');
  const [payoutSearch, setPayoutSearch] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const loadCustomers = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setCustomers([]);
      setWallets({});
      setTxRows([]);
      setErr('Database is not configured.');
      setCustLoading(false);
      return;
    }
    setCustLoading(true);
    setErr('');
    const [usersRes, walletsRes, txRes] = await Promise.all([
      supabase
        .from('app_users')
        .select('id, full_name, email, phone, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('customer_wallets').select('user_id, balance_gbp, updated_at'),
      supabase
        .from('customer_wallet_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    if (walletsRes.error && /customer_wallets|does not exist|schema cache/i.test(walletsRes.error.message || '')) {
      setErr('Run supabase/customer_wallet.sql and supabase/admin_customer_wallet.sql in the SQL editor.');
      setCustLoading(false);
      return;
    }
    if (usersRes.error) {
      setErr(usersRes.error.message || 'Could not load customers.');
      setCustLoading(false);
      return;
    }

    const wMap = {};
    for (const w of walletsRes.data || []) {
      wMap[w.user_id] = {
        balance: Math.max(0, Math.round((Number(w.balance_gbp) || 0) * 100) / 100),
        updatedAt: w.updated_at,
      };
    }
    setCustomers(usersRes.data || []);
    setWallets(wMap);
    setTxRows(txRes.data || []);
    setCustLoading(false);
  }, []);

  const loadPayouts = useCallback(async () => {
    setPayoutLoading(true);
    setErr('');
    const { rows, error } = await fetchAdminRiderWalletPayoutJobs();
    if (error) setErr(error);
    setPayoutJobs(rows);
    const ids = [...new Set(rows.map((r) => r.driverId).filter(Boolean))];
    if (ids.length && isSupabaseConfigured && supabase) {
      const { data: drivers } = await supabase
        .from('driver_registrations')
        .select('id, full_name, email, phone')
        .in('id', ids);
      const m = {};
      for (const d of drivers || []) m[d.id] = d;
      setDriverMap(m);
    } else {
      setDriverMap({});
    }
    setPayoutLoading(false);
  }, []);

  const load = useCallback(async () => {
    setMsg('');
    if (tab === 'customers') await loadCustomers();
    else await loadPayouts();
  }, [tab, loadCustomers, loadPayouts]);

  useEffect(() => {
    load();
  }, [load]);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={custLoading || payoutLoading} />,
    [load, custLoading, payoutLoading],
  );

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (!q) return true;
      const bal = wallets[c.id]?.balance;
      return (
        String(c.full_name || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.phone || '').toLowerCase().includes(q) ||
        String(c.id || '').toLowerCase().includes(q) ||
        (bal != null && String(bal).includes(q))
      );
    });
  }, [customers, wallets, search]);

  const selectedTx = useMemo(() => {
    if (!selectedUserId) return txRows.slice(0, 40);
    return txRows.filter((t) => t.user_id === selectedUserId).slice(0, 60);
  }, [txRows, selectedUserId]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedUserId) || null,
    [customers, selectedUserId],
  );

  const onCredit = async (e) => {
    e.preventDefault();
    setMsg('');
    setErr('');
    if (!selectedUserId) {
      setErr('Select a customer first.');
      return;
    }
    setCrediting(true);
    const res = await adminCreditCustomerWallet({
      userId: selectedUserId,
      amount: Number(creditAmount),
      source: creditSource,
      note: creditNote.trim(),
    });
    setCrediting(false);
    if (!res.ok) {
      setErr(res.error || 'Could not credit Ingo Kilometres.');
      return;
    }
    setMsg(
      `Credited ${formatGBP(Number(creditAmount))} to ${selectedCustomer?.full_name || 'customer'}. New balance ${formatGBP(res.balanceAfter)}. It will show on their Ingo Kilometres page.`,
    );
    setCreditAmount('');
    setCreditNote('');
    await loadCustomers();
  };

  const filteredPayouts = useMemo(() => {
    const q = payoutSearch.trim().toLowerCase();
    return payoutJobs.filter((j) => {
      const st = String(j.payoutStatus || 'pending').toLowerCase();
      const statusOk = payoutFilter === 'All' || st === payoutFilter.toLowerCase();
      const d = driverMap[j.driverId];
      const who = `${d?.full_name || ''} ${d?.email || ''}`.toLowerCase();
      const qOk =
        !q ||
        who.includes(q) ||
        String(j.ref || '').toLowerCase().includes(q) ||
        String(j.kind || '').toLowerCase().includes(q);
      return statusOk && qOk;
    });
  }, [payoutJobs, driverMap, payoutFilter, payoutSearch]);

  const onMarkPaid = async (job) => {
    setBusyKey(job.key);
    setErr('');
    setMsg('');
    const res = await markRiderWalletJobPaid(job);
    setBusyKey('');
    if (!res.ok) {
      setErr(res.error || 'Could not mark paid.');
      return;
    }
    setMsg(`Marked ${job.ref} as paid to rider.`);
    await loadPayouts();
  };

  return (
    <div className="adm">
      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0, gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="admFilters" style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              type="button"
              className={tab === 'customers' ? 'admWdBtn admWdBtn--paid' : 'admWdBtn'}
              onClick={() => setTab('customers')}
            >
              Customer Ingo Km
            </button>
            <button
              type="button"
              className={tab === 'riders' ? 'admWdBtn admWdBtn--paid' : 'admWdBtn'}
              onClick={() => setTab('riders')}
            >
              Rider payouts
            </button>
          </div>
        </div>
      </section>

      {err ? (
        <p className="admDim" style={{ color: '#b42318', marginBottom: '0.75rem' }} role="alert">
          {err}
        </p>
      ) : null}
      {msg ? (
        <p className="admDim" style={{ color: '#047857', marginBottom: '0.75rem' }} role="status">
          {msg}
        </p>
      ) : null}

      {tab === 'customers' ? (
        <>
          <section className="admCard" style={{ marginBottom: '0.85rem' }}>
            <h2 style={{ margin: '0 0 0.65rem', fontSize: '1rem' }}>Credit Ingo Kilometres</h2>
            <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              After receiving bank transfer or cash at the office (or via Support 0789 701 394), credit the
              customer&apos;s Ingo Kilometres balance. It appears on their Ingo Kilometres page history.
            </p>
            <form onSubmit={onCredit} className="admToolbar" style={{ alignItems: 'flex-end', gap: '0.65rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 220 }}>
                <span className="admDim" style={{ fontSize: '0.75rem' }}>Customer</span>
                <select
                  className="admSelect"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                >
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name || 'Customer'} · {c.email || c.phone || c.id.slice(0, 8)} ·{' '}
                      {formatGBP(wallets[c.id]?.balance || 0)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: 120 }}>
                <span className="admDim" style={{ fontSize: '0.75rem' }}>Amount</span>
                <input
                  className="admInput"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  required
                  placeholder="0.00"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: 160 }}>
                <span className="admDim" style={{ fontSize: '0.75rem' }}>Received via</span>
                <select className="admSelect" value={creditSource} onChange={(e) => setCreditSource(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 160px' }}>
                <span className="admDim" style={{ fontSize: '0.75rem' }}>Note (optional)</span>
                <input
                  className="admInput"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  placeholder="Receipt / reference"
                />
              </label>
              <button type="submit" className="admWdBtn admWdBtn--paid" disabled={crediting || !selectedUserId}>
                {crediting ? 'Crediting…' : 'Credit Ingo Km'}
              </button>
            </form>
            {selectedCustomer ? (
              <p className="admDim" style={{ margin: '0.65rem 0 0', fontSize: '0.85rem' }}>
                Selected balance:{' '}
                <strong style={{ color: '#0a58a6' }}>
                  {formatGBP(wallets[selectedCustomer.id]?.balance || 0)}
                </strong>
              </p>
            ) : null}
          </section>

          <section className="admCard" style={{ marginBottom: '0.85rem' }}>
            <div className="admToolbar" style={{ marginBottom: '0.65rem' }}>
              <div className="admSearch">
                <input
                  placeholder="Search customer, email, phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {custLoading ? (
              <p className="admDim" style={{ padding: '0.5rem' }}>
                Loading Ingo Kilometres balances…
              </p>
            ) : (
              <div className="admTableWrap">
                <table className="admTable admWideTable">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Balance</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="admDim">
                          No customers found.
                        </td>
                      </tr>
                    ) : (
                      filteredCustomers.map((c) => {
                        const bal = wallets[c.id]?.balance || 0;
                        return (
                          <tr key={c.id} style={selectedUserId === c.id ? { background: '#fff7ed' } : undefined}>
                            <td>
                              <div style={{ fontWeight: 700 }}>{c.full_name || 'Customer'}</div>
                              <div className="admDim" style={{ fontSize: '0.76rem' }}>
                                {c.email || '—'} · {c.phone || '—'}
                              </div>
                            </td>
                            <td style={{ fontWeight: 800 }}>{formatGBP(bal)}</td>
                            <td>{formatDt(wallets[c.id]?.updatedAt)}</td>
                            <td>
                              <button
                                type="button"
                                className="admWdBtn"
                                onClick={() => setSelectedUserId(c.id)}
                              >
                                Select / history
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admCard">
            <h2 style={{ margin: '0 0 0.65rem', fontSize: '1rem' }}>
              Transaction history
              {selectedCustomer ? ` — ${selectedCustomer.full_name || 'Customer'}` : ' (recent)'}
            </h2>
            <div className="admTableWrap">
              <table className="admTable admWideTable">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Label</th>
                    <th>Amount</th>
                    <th>Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTx.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="admDim">
                        No transactions yet.
                      </td>
                    </tr>
                  ) : (
                    selectedTx.map((t) => {
                      const cust = customers.find((c) => c.id === t.user_id);
                      const isCredit = t.entry_type === 'credit';
                      return (
                        <tr key={t.id}>
                          <td>{formatDt(t.created_at)}</td>
                          <td>{cust?.full_name || t.user_id?.slice?.(0, 8) || '—'}</td>
                          <td>
                            <span className={statusClass(t.entry_type)}>{t.entry_type}</span>
                          </td>
                          <td>{t.label || '—'}</td>
                          <td style={{ fontWeight: 800, color: isCredit ? '#047857' : '#b42318' }}>
                            {isCredit ? '+' : '−'}
                            {formatGBP(t.amount_gbp)}
                          </td>
                          <td>{formatGBP(t.balance_after)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="admCard" style={{ marginBottom: '0.85rem' }}>
            <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              Earnings from trips/orders the customer paid with Ingo Kilometres. Mark paid after you hand cash to the
              rider (full fare while commission is 0%).
            </p>
            <div className="admToolbar" style={{ marginBottom: 0 }}>
              <div className="admSearch">
                <input
                  placeholder="Search rider, ref, kind…"
                  value={payoutSearch}
                  onChange={(e) => setPayoutSearch(e.target.value)}
                />
              </div>
              <div className="admFilters">
                <select className="admSelect" value={payoutFilter} onChange={(e) => setPayoutFilter(e.target.value)}>
                  <option>All</option>
                  <option>pending</option>
                  <option>paid</option>
                </select>
              </div>
            </div>
          </section>

          <section className="admCard">
            {payoutLoading ? (
              <p className="admDim" style={{ padding: '1rem' }}>
                Loading Ingo Kilometres–paid jobs…
              </p>
            ) : filteredPayouts.length === 0 ? (
              <p className="admDim" style={{ padding: '1rem' }}>
                No Ingo Kilometres–paid rider jobs found yet.
              </p>
            ) : (
              <div className="admTableWrap">
                <table className="admTable admWideTable">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Rider</th>
                      <th>Gross</th>
                      <th>Net (after commission)</th>
                      <th>Status</th>
                      <th>Completed</th>
                      <th>Paid at</th>
                      <th className="admWdActionsHead">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayouts.map((j) => {
                      const d = driverMap[j.driverId];
                      const busy = busyKey === j.key;
                      const paid = String(j.payoutStatus).toLowerCase() === 'paid';
                      return (
                        <tr key={j.key}>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              {j.kind} · {j.ref}
                            </div>
                            <div className="admDim" style={{ fontSize: '0.76rem' }}>
                              {j.to}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{d?.full_name || 'Rider'}</div>
                            <div className="admDim" style={{ fontSize: '0.76rem' }}>
                              {d?.email || j.driverId}
                            </div>
                          </td>
                          <td>{formatGBP(j.gross)}</td>
                          <td style={{ fontWeight: 800 }}>{formatGBP(j.net)}</td>
                          <td>
                            <span className={statusClass(j.payoutStatus)}>{j.payoutStatus}</span>
                          </td>
                          <td>{formatDt(j.at)}</td>
                          <td>{formatDt(j.paidAt)}</td>
                          <td className="admWdActionsCell">
                            <button
                              type="button"
                              className="admWdBtn admWdBtn--paid"
                              disabled={busy || paid}
                              onClick={() => onMarkPaid(j)}
                            >
                              {busy ? '…' : paid ? 'Paid' : 'Mark paid'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
