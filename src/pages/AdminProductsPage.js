import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { formatGBP } from '../lib/currency';
import {
  notifyShopOwnerImageRemoved,
  notifyShopOwnerProductDeleted,
} from '../lib/shopOwnerAdminNotifications';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

/** Lightweight columns only — image data URLs are large, so they load lazily per product. */
const LIST_COLUMNS = 'id, shop_owner_id, name, category, price, stock, sku, is_active, created_at';

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

function parseGallery(raw) {
  try {
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'string') return JSON.parse(raw).filter(Boolean);
  } catch {
    return [];
  }
  return [];
}

/** Flatten primary + gallery into [{ url, kind, index }]. */
function flattenImages(primary, gallery) {
  const out = [];
  if (primary) out.push({ url: primary, kind: 'primary', index: -1 });
  (gallery || []).forEach((url, i) => {
    if (url) out.push({ url, kind: 'gallery', index: i });
  });
  return out;
}

function afterRemoveImage(primary, gallery, img) {
  let nextPrimary = primary;
  let nextGallery = [...gallery];
  if (img.kind === 'primary') {
    if (nextGallery.length > 0) {
      nextPrimary = nextGallery[0];
      nextGallery = nextGallery.slice(1);
    } else {
      nextPrimary = null;
    }
  } else {
    nextGallery = nextGallery.filter((_, i) => i !== img.index);
  }
  return { nextPrimary, nextGallery };
}

/** Remove primary image, or first gallery image if no primary. */
function afterRemoveFirstImage(primary, gallery) {
  if (primary) return afterRemoveImage(primary, gallery, { kind: 'primary', index: -1 });
  if (gallery.length > 0) return afterRemoveImage(primary, gallery, { kind: 'gallery', index: 0 });
  return null;
}

export default function AdminProductsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [shopFilter, setShopFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [imgState, setImgState] = useState({ loading: false, primary: null, gallery: [], error: '' });
  const [deletePrompt, setDeletePrompt] = useState(null);
  const [deleteImagePrompt, setDeleteImagePrompt] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteImageBusy, setDeleteImageBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setRows([]);
      setError('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [{ data: products, error: pErr }, { data: owners, error: oErr }] = await Promise.all([
        supabase.from('shop_products').select(LIST_COLUMNS).order('created_at', { ascending: false }),
        supabase.from('shop_owners').select('id, business_name'),
      ]);
      if (pErr) {
        setRows([]);
        setError(pErr.message);
        return;
      }
      const shopById = Object.fromEntries((owners || []).map((o) => [String(o.id), o.business_name?.trim() || 'Shop']));
      const built = (products || []).map((r) => ({
        id: r.id,
        shopOwnerId: r.shop_owner_id ? String(r.shop_owner_id) : '',
        shopName: shopById[String(r.shop_owner_id)] || 'Unknown shop',
        name: r.name || '—',
        category: r.category || 'Other',
        price: Number(r.price) || 0,
        stock: Number(r.stock) || 0,
        sku: r.sku || '',
        active: Boolean(r.is_active),
        createdIso: r.created_at ?? null,
      }));
      setRows(built);
      setError(oErr ? oErr.message : '');
    } catch (e) {
      setRows([]);
      setError(e?.message || 'Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Lazy-load the selected product's images (kept out of the list query for speed).
  useEffect(() => {
    if (!selected) {
      setImgState({ loading: false, primary: null, gallery: [], error: '' });
      return undefined;
    }
    if (!isSupabaseConfigured || !supabase) return undefined;
    let cancelled = false;
    setImgState({ loading: true, primary: null, gallery: [], error: '' });
    supabase
      .from('shop_products')
      .select('image_primary_url, image_urls')
      .eq('id', selected.id)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) {
          setImgState({ loading: false, primary: null, gallery: [], error: e.message });
          return;
        }
        setImgState({
          loading: false,
          primary: data?.image_primary_url || null,
          gallery: parseGallery(data?.image_urls),
          error: '',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useSetAdminHeaderActions(<AdminHeaderRefresh onClick={() => load()} disabled={loading} />, [loading, load]);

  const shopOptions = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (r.shopOwnerId) map.set(r.shopOwnerId, r.shopName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchShop = shopFilter === 'all' || r.shopOwnerId === shopFilter;
      const hay = `${r.name} ${r.category} ${r.shopName} ${r.sku}`.toLowerCase();
      const matchQ = !q || hay.includes(q);
      return matchShop && matchQ;
    });
  }, [rows, search, shopFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.active).length;
    const outOfStock = rows.filter((r) => r.stock === 0).length;
    return { total, active, outOfStock };
  }, [rows]);

  const removeImage = async (img) => {
    if (!selected || !isSupabaseConfigured || !supabase) return;
    setImgBusy(true);
    const { nextPrimary, nextGallery } = afterRemoveImage(imgState.primary, imgState.gallery, img);

    const { error: uErr } = await supabase
      .from('shop_products')
      .update({ image_primary_url: nextPrimary, image_urls: nextGallery })
      .eq('id', selected.id);
    setImgBusy(false);
    if (uErr) {
      setToast({ type: 'error', message: uErr.message });
      return;
    }
    setImgState((s) => ({ ...s, primary: nextPrimary, gallery: nextGallery }));
    setToast({ type: 'success', message: 'Image removed.' });
    if (selected.shopOwnerId) {
      await notifyShopOwnerImageRemoved({
        shopOwnerId: selected.shopOwnerId,
        productId: selected.id,
        productName: selected.name,
      });
    }
  };

  const confirmDeleteImage = async () => {
    if (!deleteImagePrompt || !isSupabaseConfigured || !supabase) return;
    setDeleteImageBusy(true);
    const productId = deleteImagePrompt.id;
    const productName = deleteImagePrompt.name;
    const shopOwnerId = deleteImagePrompt.shopOwnerId;
    try {
      const { data, error: fErr } = await supabase
        .from('shop_products')
        .select('image_primary_url, image_urls')
        .eq('id', productId)
        .maybeSingle();
      if (fErr) {
        setToast({ type: 'error', message: fErr.message });
        return;
      }
      const primary = data?.image_primary_url || null;
      const gallery = parseGallery(data?.image_urls);
      const next = afterRemoveFirstImage(primary, gallery);
      if (!next) {
        setToast({ type: 'error', message: 'This product has no images.' });
        return;
      }
      const { error: uErr } = await supabase
        .from('shop_products')
        .update({ image_primary_url: next.nextPrimary, image_urls: next.nextGallery })
        .eq('id', productId);
      if (uErr) {
        setToast({ type: 'error', message: uErr.message });
        return;
      }
      if (selected?.id === productId) {
        setImgState((s) => ({ ...s, primary: next.nextPrimary, gallery: next.nextGallery }));
      }
      if (shopOwnerId) {
        await notifyShopOwnerImageRemoved({ shopOwnerId, productId, productName });
      }
      setToast({ type: 'success', message: `Image removed from “${productName}”.` });
    } catch (e) {
      setToast({ type: 'error', message: e?.message || 'Could not remove image.' });
    } finally {
      setDeleteImageBusy(false);
      setDeleteImagePrompt(null);
    }
  };

  const confirmDelete = async () => {
    if (!deletePrompt) return;
    setDeleteBusy(true);
    if (!isSupabaseConfigured || !supabase) {
      setDeleteBusy(false);
      setDeletePrompt(null);
      setToast({ type: 'error', message: 'Database is not configured.' });
      return;
    }
    const { error: dErr } = await supabase.from('shop_products').delete().eq('id', deletePrompt.id);
    setDeleteBusy(false);
    if (dErr) {
      setToast({ type: 'error', message: dErr.message });
      setDeletePrompt(null);
      return;
    }
    const removedId = deletePrompt.id;
    const name = deletePrompt.name;
    const shopOwnerId = deletePrompt.shopOwnerId;
    if (shopOwnerId) {
      await notifyShopOwnerProductDeleted({
        shopOwnerId,
        productId: removedId,
        productName: name,
      });
    }
    setDeletePrompt(null);
    setSelected((cur) => (cur?.id === removedId ? null : cur));
    setRows((prev) => prev.filter((r) => r.id !== removedId));
    setToast({ type: 'success', message: `“${name}” was deleted.` });
  };

  const selectedImages = flattenImages(imgState.primary, imgState.gallery);

  return (
    <div className="adm">
      <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', maxWidth: '46rem' }}>
        All products across every shop (<code>shop_products</code>). You can delete any product or remove any of its
        images. Images load when you open a product.
      </p>

      {error ? (
        <div className="admCard" style={{ borderColor: '#f0c7c7', marginBottom: '0.85rem' }}>
          <p style={{ margin: 0, color: '#b42318' }}>{error}</p>
        </div>
      ) : null}

      <section className="admGrid3" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Total products</p>
          <p className="v">{loading ? '…' : stats.total.toLocaleString()}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Active</p>
          <p className="v" style={{ color: '#0A58A6' }}>
            {loading ? '…' : stats.active.toLocaleString()}
          </p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Out of stock</p>
          <p className="v" style={{ color: '#ec9120' }}>
            {loading ? '…' : stats.outOfStock.toLocaleString()}
          </p>
        </article>
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSearch" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, category, shop, SKU…"
            style={{ flex: '1 1 16rem' }}
          />
          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            aria-label="Filter by shop"
            style={{ flex: '0 0 auto', padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid #d8dee8' }}
          >
            <option value="all">All shops</option>
            {shopOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable admWideTable">
            <thead>
              <tr>
                <th>Product</th>
                <th>Shop</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th className="admProdActionsHead">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="admDim" style={{ padding: '1.2rem', textAlign: 'center' }}>
                    Loading products…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="admDim" style={{ padding: '1.2rem', textAlign: 'center' }}>
                    No products match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="admClickableRow" onClick={() => setSelected(p)}>
                    <td>
                      <div className="admInlineUser">
                        <span className="admMiniAvatar">{(p.name || 'P').slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{p.name}</strong>
                          {p.sku ? <div className="admDim">SKU: {p.sku}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td className="admDim">{p.shopName}</td>
                    <td>
                      <span className="admBadgeStatus admBlue">{p.category}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{formatGBP(p.price)}</td>
                    <td className={p.stock === 0 ? '' : 'admDim'} style={p.stock === 0 ? { color: '#d34444' } : undefined}>
                      {p.stock === 0 ? 'Out' : p.stock}
                    </td>
                    <td>
                      <span className={`admBadgeStatus ${p.active ? 'admGreen' : 'admBlue'}`}>
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} className="admProdActionsCell">
                      <div className="admProdActions">
                        <button
                          type="button"
                          className="admProdActionBtn admProdActionBtn--image"
                          disabled={deleteImageBusy}
                          onClick={() =>
                            setDeleteImagePrompt({
                              id: p.id,
                              name: p.name || 'this product',
                              shopOwnerId: p.shopOwnerId,
                            })
                          }
                        >
                          Delete image
                        </button>
                        <button
                          type="button"
                          className="admProdActionBtn admProdActionBtn--product"
                          onClick={() =>
                            setDeletePrompt({
                              id: p.id,
                              name: p.name || 'this product',
                              shopOwnerId: p.shopOwnerId,
                            })
                          }
                        >
                          Delete product
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
          <strong>Product detail</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {selected ? (
              <button
                className="admIconBtn"
                type="button"
                aria-label={`Delete ${selected.name}`}
                title="Delete product"
                onClick={() =>
                  setDeletePrompt({
                    id: selected.id,
                    name: selected.name || 'this product',
                    shopOwnerId: selected.shopOwnerId,
                  })
                }
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
                <h3 style={{ margin: '0 0 0.15rem' }}>{selected.name}</h3>
                <p className="admDim" style={{ margin: 0 }}>
                  {selected.shopName} · {selected.category}
                </p>
                <p style={{ margin: '0.5rem 0 0', fontWeight: 700 }}>{formatGBP(selected.price)}</p>
                <p className="admDim" style={{ margin: '0.25rem 0 0' }}>
                  {selected.stock === 0 ? 'Out of stock' : `${selected.stock} in stock`} ·{' '}
                  {selected.active ? 'Active' : 'Inactive'}
                </p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Images</h4>
                {imgState.loading ? (
                  <p className="admDim" style={{ margin: 0 }}>
                    Loading images…
                  </p>
                ) : imgState.error ? (
                  <p style={{ margin: 0, color: '#b42318' }}>{imgState.error}</p>
                ) : selectedImages.length === 0 ? (
                  <p className="admDim" style={{ margin: 0 }}>
                    No images on this product.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem' }}>
                    {selectedImages.map((img) => (
                      <div
                        key={`${img.kind}-${img.index}`}
                        style={{
                          position: 'relative',
                          borderRadius: 10,
                          overflow: 'hidden',
                          border: '1px solid #e3e8f0',
                          background: '#f4f6fa',
                          aspectRatio: '1 / 1',
                        }}
                      >
                        <img
                          src={img.url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        {img.kind === 'primary' ? (
                          <span
                            style={{
                              position: 'absolute',
                              top: 6,
                              left: 6,
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              background: 'rgba(7,64,143,0.9)',
                              color: '#fff',
                              padding: '0.1rem 0.4rem',
                              borderRadius: 999,
                            }}
                          >
                            Primary
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeImage(img)}
                          disabled={imgBusy}
                          aria-label="Remove image"
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            border: 'none',
                            background: 'rgba(211,68,68,0.95)',
                            color: '#fff',
                            fontSize: '1rem',
                            lineHeight: 1,
                            cursor: imgBusy ? 'wait' : 'pointer',
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="admDim" style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>
                  Removing the primary image promotes the next gallery image to primary.
                </p>
              </section>
            </>
          )}
        </div>
      </aside>

      {deleteImagePrompt ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-prod-img-del-title">
          <button
            type="button"
            className="admModalBackdrop"
            aria-label="Close"
            onClick={() => !deleteImageBusy && setDeleteImagePrompt(null)}
          />
          <div className="admModalCard">
            <div className="admModalCardInner">
              <div className="admModalIconWrap" aria-hidden>
                🖼
              </div>
              <h2 id="adm-prod-img-del-title" className="admModalTitle">
                Delete image?
              </h2>
              <p className="admModalText">
                Remove the primary image from <strong>{deleteImagePrompt.name}</strong>? If there are more images, the
                next one becomes primary.
              </p>
              <div className="admModalActions">
                <button
                  type="button"
                  className="admModalBtnGhost"
                  disabled={deleteImageBusy}
                  onClick={() => setDeleteImagePrompt(null)}
                >
                  Cancel
                </button>
                <button type="button" className="admModalBtnDanger" disabled={deleteImageBusy} onClick={confirmDeleteImage}>
                  {deleteImageBusy ? 'Removing…' : 'Yes, delete image'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deletePrompt ? (
        <div className="admModalRoot" role="dialog" aria-modal="true" aria-labelledby="adm-prod-del-title">
          <button
            type="button"
            className="admModalBackdrop"
            aria-label="Close"
            onClick={() => !deleteBusy && setDeletePrompt(null)}
          />
          <div className="admModalCard">
            <div className="admModalCardInner">
              <div className="admModalIconWrap" aria-hidden>
                🗑
              </div>
              <h2 id="adm-prod-del-title" className="admModalTitle">
                Delete product?
              </h2>
              <p className="admModalText">
                <strong>{deletePrompt.name}</strong> will be permanently removed from <code>shop_products</code>. This
                cannot be undone.
              </p>
              <div className="admModalActions">
                <button type="button" className="admModalBtnGhost" disabled={deleteBusy} onClick={() => setDeletePrompt(null)}>
                  Cancel
                </button>
                <button type="button" className="admModalBtnDanger" disabled={deleteBusy} onClick={confirmDelete}>
                  {deleteBusy ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 400,
            padding: '0.7rem 1.1rem',
            borderRadius: 10,
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.88rem',
            background: toast.type === 'error' ? '#c62828' : '#128a4b',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
