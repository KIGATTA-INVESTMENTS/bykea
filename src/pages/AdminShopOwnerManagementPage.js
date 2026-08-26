import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import { formatShopOwnerPayoutSummary } from '../lib/shopOwnerPayoutAccount';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

/** @typedef {{
 *  id: string;
 *  shop: string;
 *  owner: string;
 *  type: string;
 *  cityLabel: string;
 *  addressFull: string;
 *  email: string;
 *  phone: string;
 *  orders: number;
 *  ordersLinked: number;
 *  revenue: number;
 *  products: number;
 *  joined: string;
 *  createdIso: string | null;
 *  status: string;
 *  shop_image_url?: string | null;
 *  referralCode: string | null;
 *  payoutSummary: ReturnType<typeof formatShopOwnerPayoutSummary>;
 * }} ShopOwnerRow */

function formatJoinLabel(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return '—';
  }
}

function addressFirstLine(addr) {
  const t = String(addr || '').trim();
  if (!t) return '—';
  const first = t.split(/[\n,]/)[0]?.trim() || t;
  return first.slice(0, 48) + (first.length > 48 ? '…' : '');
}

function initialsFromShop(name) {
  const n = String(name || '').trim();
  if (!n) return 'SH';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function statusClass(status) {
  if (status === 'Active') return 'admBadgeStatus admGreen';
  return 'admBadgeStatus admBlue';
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

export default function AdminShopOwnerManagementPage() {
  const [rows, setRows] = useState([]); // ShopOwnerRow[]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('All'); // All | With orders
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  /** @type {{ id: string; shop: string; ordersLinked: number } | null} */
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
    const errs = [];

    try {
      const PAYOUT_COLS =
        'bank_name, bank_account_name, bank_account_number, bank_branch, payout_method, mobile_money_provider, mobile_money_phone, mobile_money_account_name';
      let { data: owners, error: oErr } = await supabase
        .from('shop_owners')
        .select(
          `id, business_name, owner_full_name, phone, email, business_type, business_address, shop_image_url, referral_code, created_at, ${PAYOUT_COLS}`,
        )
        .order('created_at', { ascending: false });

      if (
        oErr &&
        /payout_method|mobile_money|bank_name|bank_account_name|bank_account_number|bank_branch|column/i.test(
          oErr.message || '',
        )
      ) {
        const BANK_ONLY = 'bank_name, bank_account_name, bank_account_number, bank_branch';
        ({ data: owners, error: oErr } = await supabase
          .from('shop_owners')
          .select(
            `id, business_name, owner_full_name, phone, email, business_type, business_address, shop_image_url, referral_code, created_at, ${BANK_ONLY}`,
          )
          .order('created_at', { ascending: false }));
        if (oErr && /bank_name|column/i.test(oErr.message || '')) {
          ({ data: owners, error: oErr } = await supabase
            .from('shop_owners')
            .select(
              'id, business_name, owner_full_name, phone, email, business_type, business_address, shop_image_url, referral_code, created_at',
            )
            .order('created_at', { ascending: false }));
        }
      }

      if (oErr) {
        errs.push(oErr.message);
        setRows([]);
        setError(errs.join(' · '));
        return;
      }

      const ownerList = Array.isArray(owners) ? owners : [];

      const [{ data: ordersData, error: ordErr }, { data: linesData, error: linErr }, { data: productsData, error: prodErr }] =
        await Promise.all([
          supabase.from('shop_customer_orders').select('id, status, subtotal, placed_at'),
          supabase.from('shop_customer_order_lines').select('order_id, shop_owner_id, line_total'),
          supabase.from('shop_products').select('shop_owner_id'),
        ]);

      if (ordErr) errs.push(ordErr.message);
      if (linErr) errs.push(linErr.message);
      if (prodErr) errs.push(prodErr.message);

      /** @type {Record<string, string>} */
      const orderStatus = {};
      (ordersData || []).forEach((o) => {
        if (o?.id) orderStatus[o.id] = String(o.status || '').toLowerCase();
      });

      /** @type {Record<string, { orderIds: Set<string>; revenue: number }>} */
      const agg = {};
      const ensure = (sid) => {
        if (!sid) return;
        if (!agg[sid]) agg[sid] = { orderIds: new Set(), revenue: 0 };
      };

      (linesData || []).forEach((line) => {
        const oid = line.order_id;
        const sid = line.shop_owner_id;
        if (!oid || !sid) return;
        const st = orderStatus[oid];
        const cancelled = st === 'cancelled';
        ensure(sid);
        const bucket = agg[sid];
        bucket.orderIds.add(oid);
        if (!cancelled) {
          const n = Number(line.line_total);
          if (Number.isFinite(n)) bucket.revenue += n;
        }
      });

      /** @type {Record<string, number>} */
      const prodCount = {};
      (productsData || []).forEach((p) => {
        const id = p.shop_owner_id;
        if (!id) return;
        prodCount[id] = (prodCount[id] || 0) + 1;
      });

      const built = ownerList.map((r) => {
        const bucket = agg[r.id];
        const orderIds = bucket?.orderIds || new Set();

        let revenueNet = bucket?.revenue ?? 0;
        if ([...orderIds].length === 0) {
          revenueNet = 0;
        }

        const nonCancelledOrderCount = [...orderIds].filter((oid) => orderStatus[oid] !== 'cancelled').length;
        const ordersLinked = orderIds.size;

        return {
          id: r.id,
          shop: r.business_name?.trim() || '—',
          owner: r.owner_full_name?.trim() || '—',
          type: r.business_type?.trim() || 'Other',
          cityLabel: addressFirstLine(r.business_address),
          addressFull: r.business_address ?? '—',
          email: r.email ?? '—',
          phone: r.phone ?? '—',
          orders: nonCancelledOrderCount,
          ordersLinked,
          revenue: revenueNet,
          products: prodCount[r.id] || 0,
          joined: formatJoinLabel(r.created_at),
          createdIso: r.created_at ?? null,
          status: 'Active',
          shop_image_url: r.shop_image_url,
          referralCode: r.referral_code?.trim() || null,
          payoutSummary: formatShopOwnerPayoutSummary(r),
        };
      });

      setRows(built);
      setError(errs.length ? errs.slice(0, 2).join(' · ') : '');
    } catch (e) {
      setRows([]);
      setError(e?.message || 'Failed to load shop owners.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected && !pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (deleteWorking) return;
      setSelected(null);
      setPendingDelete(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, pendingDelete, deleteWorking]);

  const confirmDelete = async () => {
    if (!pendingDelete?.id || !isSupabaseConfigured || !supabase) {
      setDeleteErr(!supabase ? 'Database is not configured.' : 'No shop owner selected.');
      return;
    }
    setDeleteWorking(true);
    setDeleteErr('');
    const { error: dErr } = await supabase.from('shop_owners').delete().eq('id', pendingDelete.id);
    setDeleteWorking(false);
    if (dErr) {
      const raw = String(dErr.message || 'Delete failed.');
      let hint =
        /policy|permission|denied/i.test(raw) ? ' Run shop_owners_delete_anon.sql if delete is blocked by RLS.' : '';
      if (/foreign key|violates|23503/i.test(raw)) {
        hint =
          ' This shop is still referenced on checkout order lines — remove those orders/lines first, or relax the FK in the database.';
      }
      setDeleteErr(raw + hint);
      return;
    }
    const removedId = pendingDelete.id;
    setPendingDelete(null);
    setSelected((cur) => (cur?.id === removedId ? null : cur));
    setRows((prev) => prev.filter((r) => r.id !== removedId));
    await load();
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const withSales = rows.filter((r) => r.orders > 0).length;
    const weekAgo = Date.now() - 7 * 86400000;
    const newWeek = rows.filter((r) => r.createdIso && new Date(r.createdIso).getTime() >= weekAgo).length;
    return { total, withSales, newWeek };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((item) => {
      const hay = [item.shop, item.owner, item.type, item.cityLabel, item.email, item.phone, item.addressFull]
        .join(' ')
        .toLowerCase();
      const matchQ = !q || hay.includes(q);
      const matchTab = tab === 'All' || (tab === 'With orders' && item.orders > 0);
      return matchQ && matchTab;
    });
  }, [rows, search, tab]);

  useSetAdminHeaderActions(
    <AdminHeaderRefresh onClick={() => load()} disabled={loading} />,
    [loading, load],
  );

  return (
    <div className="adm">
      <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', maxWidth: '44rem' }}>
        Profiles from <strong>/shop-owner/register</strong> (<code>shop_owners</code>). Orders and revenue are aggregated from checkout lines tied to each owner.
      </p>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
          <p className="admDim" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Run <code style={{ fontSize: '0.82rem' }}>shop_owners.sql</code> from the repo if the table is missing.
          </p>
        </div>
      ) : null}

      <section className="admGrid3" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Registered shops</p>
          <p className="v">{loading ? '…' : stats.total.toLocaleString()}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">With customer orders</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : stats.withSales.toLocaleString()}
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">New (last 7 days)</p>
          <p className="v" style={{ color: '#ec9120' }}>
            {loading ? '…' : stats.newWeek.toLocaleString()}
          </p>
        </article>
      </section>

      <section className="admTabs">
        <button type="button" className={tab === 'All' ? 'active' : ''} onClick={() => setTab('All')}>
          All
        </button>
        <button type="button" className={tab === 'With orders' ? 'active' : ''} onClick={() => setTab('With orders')}>
          With orders
        </button>
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSearch">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shop, owner, email, phone, address…"
          />
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable admWideTable">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Email</th>
                <th>Referral code</th>
                <th>Business type</th>
                <th>Area</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>Products</th>
                <th>Joined</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="admDim" style={{ padding: '1.2rem', textAlign: 'center' }}>
                    Loading shop owners…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="admDim" style={{ padding: '1.2rem', textAlign: 'center' }}>
                    No shop owners match your filters. Registrations appear here after signup.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="admClickableRow" onClick={() => setSelected(item)}>
                    <td>
                      <div className="admInlineUser">
                        <span className="admMiniAvatar">{initialsFromShop(item.shop)}</span>
                        <div>
                          <strong>{item.shop}</strong>
                          <div className="admDim">{item.owner}</div>
                        </div>
                      </div>
                    </td>
                    <td className="admDim" style={{ maxWidth: '14rem', wordBreak: 'break-all', fontSize: '0.82rem' }} title={item.email}>
                      {item.email}
                    </td>
                    <td className="admDim">{item.referralCode || '—'}</td>
                    <td>
                      <span className="admBadgeStatus admBlue">{item.type}</span>
                    </td>
                    <td className="admDim" title={item.addressFull}>
                      {item.cityLabel}
                    </td>
                    <td>{item.orders}</td>
                    <td style={{ color: '#0A58A6', fontWeight: 700 }}>{formatGBP(item.revenue)}</td>
                    <td>{item.products}</td>
                    <td className="admDim">{item.joined}</td>
                    <td>
                      <span className={statusClass(item.status)}>{item.status}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admActions">
                        <button type="button" aria-label="View details" onClick={() => setSelected(item)}>
                          👁
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${item.shop}`}
                          style={{ color: '#d34444' }}
                          onClick={() => {
                            setPendingDelete({ id: item.id, shop: item.shop, ordersLinked: item.ordersLinked });
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

      <aside className={`admPanel${selected ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Shop owner detail</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {selected ? (
              <button
                className="admIconBtn"
                type="button"
                aria-label={`Delete ${selected.shop}`}
                title="Delete shop owner"
                onClick={() => {
                  setPendingDelete({ id: selected.id, shop: selected.shop, ordersLinked: selected.ordersLinked });
                  setDeleteErr('');
                }}
              >
                <span style={{ color: '#d34444', display: 'inline-flex', verticalAlign: 'middle' }}>
                  <IconTrash />
                </span>
              </button>
            ) : null}
            <button className="admIconBtn" type="button" onClick={() => setSelected(null)} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="admPanelBody">
          {selected && (
            <>
              <section className="admPanelBlock">
                <div className="admInlineUser">
                  <span className="admAvatar" style={{ width: 42, height: 42 }}>
                    {initialsFromShop(selected.shop)}
                  </span>
                  <div>
                    <h3 style={{ margin: 0 }}>{selected.shop}</h3>
                    <span className={statusClass(selected.status)}>{selected.status}</span>
                    <p className="admDim" style={{ margin: '0.35rem 0 0', fontSize: '0.76rem', wordBreak: 'break-all' }}>
                      Owner id: {selected.id}
                    </p>
                  </div>
                </div>
                {selected.shop_image_url ? (
                  <p style={{ margin: '0.65rem 0 0', fontSize: '0.82rem' }}>
                    <span className="admDim">Storefront / logo:</span>{' '}
                    <a href={selected.shop_image_url} target="_blank" rel="noopener noreferrer">
                      Open image
                    </a>
                  </p>
                ) : null}
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Owner</h4>
                <p style={{ margin: '0 0 0.25rem' }}>
                  <strong>{selected.owner}</strong>
                </p>
                <p className="admDim" style={{ margin: 0 }}>
                  {selected.phone}
                </p>
                <p className="admDim" style={{ margin: '0.35rem 0 0', wordBreak: 'break-all' }}>
                  {selected.email}
                </p>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
                  <span className="admDim">Referral code:</span>{' '}
                  {selected.referralCode ? (
                    <span className="admBadgeStatus admBlue">{selected.referralCode}</span>
                  ) : (
                    <span className="admDim">None</span>
                  )}
                </p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Business</h4>
                <p style={{ margin: '0 0 0.25rem' }}>Type: {selected.type}</p>
                <p className="admDim" style={{ margin: 0, lineHeight: 1.45 }}>
                  {selected.addressFull}
                </p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Payout account</h4>
                {selected.payoutSummary ? (
                  <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.88rem' }}>
                    <div>
                      <span className="admDim">Method:</span>{' '}
                      <span className="admBadgeStatus admBlue">{selected.payoutSummary.method}</span>
                    </div>
                    {selected.payoutSummary.method === 'Mobile money' ? (
                      <>
                        <div>
                          <span className="admDim">Provider:</span> {selected.payoutSummary.provider}
                        </div>
                        <div>
                          <span className="admDim">Name on account:</span> {selected.payoutSummary.accountName}
                        </div>
                        <div style={{ wordBreak: 'break-all' }}>
                          <span className="admDim">Mobile money phone:</span> {selected.payoutSummary.phone}
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="admDim">Bank:</span> {selected.payoutSummary.bankName}
                        </div>
                        <div>
                          <span className="admDim">Account name:</span> {selected.payoutSummary.accountName}
                        </div>
                        <div style={{ wordBreak: 'break-all' }}>
                          <span className="admDim">Account number:</span> {selected.payoutSummary.accountNumber}
                        </div>
                        <div>
                          <span className="admDim">Branch / code:</span> {selected.payoutSummary.branch}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="admDim" style={{ margin: 0 }}>
                    No payout details on file.
                  </p>
                )}
              </section>

              <section className="admGrid2" style={{ marginBottom: '0.75rem' }}>
                <div className="admPanelBlock">
                  <strong>{selected.orders}</strong>
                  <p className="admDim" style={{ margin: 0 }}>
                    Customer orders (non-cancelled)
                  </p>
                </div>
                <div className="admPanelBlock">
                  <strong>{formatGBP(selected.revenue)}</strong>
                  <p className="admDim" style={{ margin: 0 }}>
                    Line revenue excl. cancelled
                  </p>
                </div>
                <div className="admPanelBlock">
                  <strong>{selected.products}</strong>
                  <p className="admDim" style={{ margin: 0 }}>
                    Products listed
                  </p>
                </div>
                <div className="admPanelBlock">
                  <strong>{selected.joined}</strong>
                  <p className="admDim" style={{ margin: 0 }}>
                    Registered
                  </p>
                </div>
              </section>
            </>
          )}
        </div>
      </aside>

      {pendingDelete ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-shop-owner-del-title">
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
              <h2 id="adm-shop-owner-del-title" className="admModalTitle">
                Delete shop owner?
              </h2>
              <p className="admModalText">
                Removes <strong>{pendingDelete.shop}</strong> from <code>shop_owners</code>. Their listed products are removed automatically (
                cascade).{' '}
                {pendingDelete.ordersLinked > 0 ? (
                  <>
                    Their shop appears on <strong>{pendingDelete.ordersLinked}</strong> checkout order(s) in history—the database may{' '}
                    <strong>block</strong> delete until those order lines are removed.
                  </>
                ) : (
                  <>If delete fails, order lines may still reference this shop (check SQL policies / FKs).</>
                )}
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
