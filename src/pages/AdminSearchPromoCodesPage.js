import { useCallback, useMemo, useState } from 'react';
import { normalizeReferralCode } from '../lib/referralCodes';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const ROLE_TABS = ['All', 'Customers', 'Drivers', 'Shop owners'];

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function roleBadgeClass(role) {
  if (role === 'Customer') return 'admBadgeStatus admBlue';
  if (role === 'Driver') return 'admBadgeStatus admGreen';
  return 'admBadgeStatus admOrange';
}

/**
 * @param {string} code
 * @returns {Promise<{ rows: Array<Record<string, unknown>>; codeLabel: string | null; error: string }>}
 */
async function fetchSignupsForPromoCode(code) {
  if (!isSupabaseConfigured || !supabase) {
    return { rows: [], codeLabel: null, error: 'Database is not configured.' };
  }

  const [customersRes, driversRes, shopsRes, codeRes] = await Promise.all([
    supabase
      .from('app_users')
      .select('id, full_name, phone, email, referral_code, created_at')
      .eq('referral_code', code)
      .order('created_at', { ascending: false }),
    supabase
      .from('driver_registrations')
      .select('id, full_name, phone, email, referral_code, created_at, status, vehicle_type, vehicle_plate')
      .eq('referral_code', code)
      .order('created_at', { ascending: false }),
    supabase
      .from('shop_owners')
      .select('id, owner_full_name, business_name, phone, email, referral_code, created_at')
      .eq('referral_code', code)
      .order('created_at', { ascending: false }),
    supabase.from('referral_codes').select('code, label').eq('code', code).maybeSingle(),
  ]);

  const errs = [customersRes.error, driversRes.error, shopsRes.error, codeRes.error]
    .filter(Boolean)
    .map((e) => e.message || String(e));
  if (errs.length) {
    return { rows: [], codeLabel: null, error: errs.join(' · ') };
  }

  /** @type {Array<Record<string, unknown>>} */
  const rows = [];

  (customersRes.data || []).forEach((r) => {
    rows.push({
      id: `customer-${r.id}`,
      role: 'Customer',
      name: r.full_name?.trim() || '—',
      email: r.email?.trim() || '—',
      phone: r.phone?.trim() || '—',
      detail: '—',
      status: '—',
      joinedIso: r.created_at,
      joined: formatDt(r.created_at),
    });
  });

  (driversRes.data || []).forEach((r) => {
    const vehicle = [r.vehicle_type, r.vehicle_plate].filter(Boolean).join(' · ');
    rows.push({
      id: `driver-${r.id}`,
      role: 'Driver',
      name: r.full_name?.trim() || '—',
      email: r.email?.trim() || '—',
      phone: r.phone?.trim() || '—',
      detail: vehicle || '—',
      status: r.status?.trim() || '—',
      joinedIso: r.created_at,
      joined: formatDt(r.created_at),
    });
  });

  (shopsRes.data || []).forEach((r) => {
    rows.push({
      id: `shop-${r.id}`,
      role: 'Shop owner',
      name: r.owner_full_name?.trim() || '—',
      email: r.email?.trim() || '—',
      phone: r.phone?.trim() || '—',
      detail: r.business_name?.trim() || '—',
      status: '—',
      joinedIso: r.created_at,
      joined: formatDt(r.created_at),
    });
  });

  rows.sort((a, b) => new Date(b.joinedIso || 0).getTime() - new Date(a.joinedIso || 0).getTime());

  return {
    rows,
    codeLabel: codeRes.data?.label?.trim() || null,
    error: '',
  };
}

export default function AdminSearchPromoCodesPage() {
  const [query, setQuery] = useState('');
  const [searchedCode, setSearchedCode] = useState('');
  const [codeLabel, setCodeLabel] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState('All');

  const runSearch = useCallback(async (raw) => {
    const code = normalizeReferralCode(raw);
    if (!code) {
      setError('Enter a promo code to search.');
      setHasSearched(false);
      setRows([]);
      setSearchedCode('');
      setCodeLabel(null);
      return;
    }

    setLoading(true);
    setError('');
    setHasSearched(true);
    setSearchedCode(code);
    setActiveTab('All');

    const result = await fetchSignupsForPromoCode(code);
    setLoading(false);
    setRows(result.rows);
    setCodeLabel(result.codeLabel);
    setError(result.error);
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    runSearch(query);
  };

  const filtered = useMemo(() => {
    if (activeTab === 'Customers') return rows.filter((r) => r.role === 'Customer');
    if (activeTab === 'Drivers') return rows.filter((r) => r.role === 'Driver');
    if (activeTab === 'Shop owners') return rows.filter((r) => r.role === 'Shop owner');
    return rows;
  }, [rows, activeTab]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      customers: rows.filter((r) => r.role === 'Customer').length,
      drivers: rows.filter((r) => r.role === 'Driver').length,
      shops: rows.filter((r) => r.role === 'Shop owner').length,
    }),
    [rows],
  );

  return (
    <div>
      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>Search promo codes</h2>
        <p className="admDim" style={{ margin: 0 }}>
          Find everyone who signed up with a referral / promo code (customers, drivers, and shop owners).
        </p>
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <form className="admToolbar" onSubmit={onSubmit} style={{ alignItems: 'stretch', marginBottom: 0 }}>
          <label className="admSearch admSearch--row" style={{ flex: 1 }}>
            <span className="admDim" style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.25rem', display: 'block' }}>
              Promo code
            </span>
            <input
              className="admSearchInput"
              placeholder="e.g. INGO-PROMO01"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="admOutlineBtn" disabled={loading} style={{ alignSelf: 'flex-end' }}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
      </section>

      {error ? (
        <p className="admCard" style={{ color: '#b42318', fontWeight: 600 }} role="alert">
          {error}
        </p>
      ) : null}

      {hasSearched && !loading && !error ? (
        <>
          <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
            <article className="admCard admSmallCard">
              <p className="k">Promo code</p>
              <p className="v" style={{ fontSize: '1rem', color: '#0A58A6' }}>
                {searchedCode}
              </p>
              {codeLabel ? <p className="admDim" style={{ margin: '0.25rem 0 0', fontSize: '0.78rem' }}>{codeLabel}</p> : null}
            </article>
            <article className="admCard admSmallCard">
              <p className="k">Total sign-ups</p>
              <p className="v">{counts.total}</p>
            </article>
            <article className="admCard admSmallCard">
              <p className="k">Customers</p>
              <p className="v">{counts.customers}</p>
            </article>
            <article className="admCard admSmallCard">
              <p className="k">Drivers</p>
              <p className="v">{counts.drivers}</p>
            </article>
            <article className="admCard admSmallCard">
              <p className="k">Shop owners</p>
              <p className="v">{counts.shops}</p>
            </article>
          </section>

          <section className="admTabs">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={activeTab === tab ? 'active' : ''}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </section>

          <section className="admCard" style={{ marginTop: '0.85rem' }}>
            <div className="admTableWrap">
              <table className="admTable">
                <thead>
                  <tr>
                    <th>Signed up</th>
                    <th>Role</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Details</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '1.2rem', color: '#666' }}>
                        No sign-ups found for <strong>{searchedCode}</strong>
                        {activeTab !== 'All' ? ` in ${activeTab.toLowerCase()}` : ''}.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.id}>
                        <td>{r.joined}</td>
                        <td>
                          <span className={roleBadgeClass(r.role)}>{r.role}</span>
                        </td>
                        <td>{r.name}</td>
                        <td className="admDim">{r.email}</td>
                        <td className="admDim">{r.phone}</td>
                        <td className="admDim">{r.detail}</td>
                        <td className="admDim">{r.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {!hasSearched && !loading ? (
        <p className="admCard admDim" style={{ textAlign: 'center', padding: '1.5rem' }}>
          Enter a promo code above and click Search.
        </p>
      ) : null}
    </div>
  );
}
