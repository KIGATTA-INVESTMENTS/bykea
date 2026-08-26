import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ProductCategoryField from '../components/shopOwner/ProductCategoryField';
import ProductTagsInput from '../components/shopOwner/ProductTagsInput';
import { formatGBP } from '../lib/currency';
import { compressImageToDataUrl } from '../lib/compressImageToDataUrl';
import {
  normalizeProductCategory,
  normalizeProductTags,
  productMatchesSearch,
} from '../lib/shopProductCategories';
import { mapShopProductRow } from '../lib/shopProductMap';
import { resolveShopMediaUrl } from '../lib/shopMediaUpload';
import { fetchShopOwnerAdminNotificationItems } from '../lib/shopOwnerAdminNotifications';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import {
  getShopOwnerNotificationsReadSet,
  markShopOwnerNotificationsRead,
} from '../lib/shopOwnerNotifications';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerProductsPremium.css';

const STOCK_FILT = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'In stock' },
  { id: 'out', label: 'Out of stock' },
];
const SORTS = ['Name (A–Z)', 'Name (Z–A)', 'Price: low to high', 'Price: high to low', 'Stock: low to high'];

function IcPlus() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 5.5V18.5M5.5 12h12" strokeLinecap="round" />
    </svg>
  );
}
function IcEdit() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
      <path
        d="M4 19.2L4.3 16l7.8-7.8a1.1 1.1 0 0 0 0-1.5L12 5.5a1.1 1.1 0 0 0-1.5 0L2.5 14.1 2.2 18.5 4.5 20Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IcTrash() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
      <path
        d="M4 7.5h16M6.5 7.5V18a.8.8 0 0 0 .2.1h9.6A.8.8 0 0 0 16.5 18V7.5M9.5 10.2V15M12.2 10.2V15M7.2 4.2h6.1l.5-1.2H7.1l.1 0.2Z"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IcSearch() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden className="soprd-search-icon">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IcCamera() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M4 8h3l1.5-2h7L16 8h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IcChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const emptyForm = () => ({
  name: '',
  category: 'Other',
  brandName: '',
  tags: [],
  description: '',
  price: '',
  compare: '',
  stock: '',
  sku: '',
  weight: '',
  active: true,
  offersFreeDelivery: false,
  hasVariants: false,
  variants: [],
});

export default function ShopOwnerProductsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [stockF, setStockF] = useState('all');
  const [sort, setSort] = useState(SORTS[0]);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editId, setEditId] = useState(null);
  const [editError, setEditError] = useState('');
  const [f, setF] = useState(() => emptyForm());
  const [images, setImages] = useState([null, null, null, null, null]);
  const [vType, setVType] = useState('Size');
  const [vName, setVName] = useState('');
  const [vPrice, setVPrice] = useState('');
  const [vStock, setVStock] = useState('');
  const fileEditRef = useRef(null);
  const slotEditRef = useRef(0);
  const [imageEditBusy, setImageEditBusy] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [adminAlerts, setAdminAlerts] = useState([]);

  const loadProducts = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    const session = getShopOwnerSession();
    if (!session?.id) {
      setList([]);
      setAdminAlerts([]);
      setLoadError('Sign in as a shop owner to see your catalog.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setList([]);
      setAdminAlerts([]);
      setLoadError('Supabase is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }
    const readSet = getShopOwnerNotificationsReadSet();
    const [{ data, error }, adminRes] = await Promise.all([
      supabase
        .from('shop_products')
        .select('*')
        .eq('shop_owner_id', session.id)
        .order('created_at', { ascending: false }),
      fetchShopOwnerAdminNotificationItems(session.id, readSet),
    ]);
    setLoading(false);
    if (error) {
      setList([]);
      setLoadError(error.message);
    } else {
      setList((data || []).map(mapShopProductRow));
    }
    setAdminAlerts((adminRes.items || []).filter((n) => !n.read).slice(0, 5));
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!deletePrompt) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !deleteBusy) setDeletePrompt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deletePrompt, deleteBusy]);

  useEffect(() => {
    if (location.state?.refreshProducts) {
      loadProducts();
      navigate('/shop-owner/products', { replace: true });
      return;
    }
    const added = location.state?.addedProduct;
    if (!added?.id) return;
    setList((L) => (L.some((p) => p.id === added.id) ? L : [...L, added]));
    navigate('/shop-owner/products', { replace: true });
  }, [location.state, navigate, loadProducts]);

  const dismissAdminAlert = (alertId) => {
    markShopOwnerNotificationsRead([alertId]);
    setAdminAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const openEdit = (p) => {
    setEditError('');
    setEditId(p.id);
    setF({
      name: p.name,
      category: p.category || 'Other',
      brandName: p.brandName || '',
      tags: normalizeProductTags(p.tags),
      description: p.description ?? '',
      price: String(p.price),
      compare: p.compareAt ?? '',
      stock: String(p.stock),
      sku: p.sku ?? '',
      weight: p.weight ?? '',
      active: p.active,
      offersFreeDelivery: Boolean(p.offersFreeDelivery),
      hasVariants: Boolean(p.hasVariants),
      variants: Array.isArray(p.variants) ? [...p.variants] : [],
    });
    const slots = [null, null, null, null, null];
    if (p.primaryImageUrl) {
      slots[0] = { dataUrl: p.primaryImageUrl, name: 'Image' };
    }
    (p.galleryImageUrls || []).slice(0, 4).forEach((url, idx) => {
      if (url) slots[idx + 1] = { dataUrl: url, name: 'Image' };
    });
    setImages(slots);
  };
  const closeP = () => {
    setEditId(null);
    setEditError('');
  };

  const pickSlotEdit = (i) => {
    slotEditRef.current = i;
    fileEditRef.current?.click();
  };

  const onFileEditChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file?.type.startsWith('image/')) return;
    if (file.size > 12 * 1024 * 1024) return;
    const i = slotEditRef.current;
    setImageEditBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file, 960, 0.78);
      setImages((m) => {
        const n = [...m];
        n[i] = { dataUrl, name: file.name, file };
        return n;
      });
    } catch {
      // ignore
    } finally {
      setImageEditBusy(false);
    }
  };

  const rmSlot = (i) => {
    setImages((m) => {
      const n = [...m];
      n[i] = null;
      return n;
    });
  };
  const addVar = () => {
    if (!vName.trim()) return;
    setF((p) => ({
      ...p,
      variants: [...p.variants, { type: vType, name: vName, price: vPrice || f.price, stock: vStock || f.stock || '0' }],
    }));
    setVName('');
    setVPrice('');
    setVStock('');
  };
  const save = async (e) => {
    e.preventDefault();
    if (!editId) return;
    setEditError('');
    const price = parseFloat(f.price) || 0;
    const st = parseInt(f.stock, 10);
    const session = getShopOwnerSession();

    if (isSupabaseConfigured && supabase && session?.id) {
      try {
        const slots = await Promise.all(
          [0, 1, 2, 3, 4].map((idx) => {
            const slot = images[idx];
            if (!slot || typeof slot !== 'object') return Promise.resolve(null);
            return resolveShopMediaUrl({
              ownerId: session.id,
              productKey: editId,
              slotIndex: idx,
              file: slot.file || null,
              url: slot.dataUrl || null,
            });
          }),
        );
        const primary = slots[0] || null;
        const galleryUrls = slots.slice(1).filter(Boolean);
        const tags = normalizeProductTags(f.tags);
        const payload = {
          name: f.name.trim(),
          category: normalizeProductCategory(f.category),
          brand_name: f.brandName.trim() || null,
          description: f.description.trim() || null,
          price,
          compare_at_price: f.compare ? parseFloat(f.compare) : null,
          stock: Number.isFinite(st) ? st : 0,
          sku: f.sku.trim() || null,
          weight: f.weight.trim() || null,
          is_active: f.active,
          offers_free_delivery: Boolean(f.offersFreeDelivery),
          has_variants: f.hasVariants,
          variants: f.variants,
          image_primary_url: primary,
          image_urls: galleryUrls,
          tags,
        };

        let { error } = await supabase
          .from('shop_products')
          .update(payload)
          .eq('id', editId)
          .eq('shop_owner_id', session.id);
        if (error && /brand_name|offers_free_delivery|schema cache/i.test(error.message || '')) {
          const { brand_name: _b, offers_free_delivery: _f, ...withoutMarketplace } = payload;
          ({ error } = await supabase
            .from('shop_products')
            .update(withoutMarketplace)
            .eq('id', editId)
            .eq('shop_owner_id', session.id));
        }
        if (error && /tags|column|schema cache/i.test(error.message || '')) {
          const { tags: _omit, brand_name: _b2, offers_free_delivery: _f2, ...withoutTags } = payload;
          ({ error } = await supabase
            .from('shop_products')
            .update(withoutTags)
            .eq('id', editId)
            .eq('shop_owner_id', session.id));
        }
        if (error) {
          setEditError(error.message);
          return;
        }
        await loadProducts();
        closeP();
      } catch (err) {
        setEditError(err?.message || 'Could not save product images.');
      }
      return;
    }

    const primary =
      images[0] && typeof images[0] === 'object' && images[0].dataUrl ? images[0].dataUrl : null;
    const galleryUrls = [1, 2, 3, 4]
      .map((i) => (images[i] && typeof images[i] === 'object' && images[i].dataUrl ? images[i].dataUrl : null))
      .filter(Boolean);

    setList((L) =>
      L.map((p) =>
        p.id === editId
          ? {
              ...p,
              name: f.name,
              category: normalizeProductCategory(f.category),
              brandName: f.brandName.trim(),
              tags: normalizeProductTags(f.tags),
              description: f.description,
              price,
              compareAt: f.compare ? parseFloat(f.compare) : null,
              stock: Number.isFinite(st) ? st : 0,
              sku: f.sku,
              weight: f.weight,
              active: f.active,
              offersFreeDelivery: Boolean(f.offersFreeDelivery),
              hasVariants: f.hasVariants,
              variants: f.variants,
              primaryImageUrl: primary,
              galleryImageUrls: galleryUrls,
            }
          : p,
      ),
    );
    closeP();
  };

  const openDeletePrompt = (p) => {
    setDeletePrompt({ id: p.id, name: p.name || 'this product' });
  };

  const confirmDelete = async () => {
    if (!deletePrompt) return;
    const { id, name } = deletePrompt;
    setDeleteBusy(true);
    try {
      const session = getShopOwnerSession();
      if (isSupabaseConfigured && supabase && session?.id) {
        const { error } = await supabase.from('shop_products').delete().eq('id', id).eq('shop_owner_id', session.id);
        if (error) {
          setToast({ type: 'error', message: error.message });
          setDeleteBusy(false);
          setDeletePrompt(null);
          return;
        }
        await loadProducts();
        setDeletePrompt(null);
        setDeleteBusy(false);
        setToast({ type: 'success', message: `“${name}” was removed from your catalog.` });
        return;
      }
      setList((L) => L.filter((p) => p.id !== id));
      setDeletePrompt(null);
      setDeleteBusy(false);
      setToast({ type: 'success', message: `“${name}” was removed from your catalog.` });
    } catch {
      setDeletePrompt(null);
      setDeleteBusy(false);
      setToast({ type: 'error', message: 'Something went wrong. Try again.' });
    }
  };

  const toggleA = async (id) => {
    const session = getShopOwnerSession();
    const row = list.find((p) => p.id === id);
    if (!row) return;
    const next = !row.active;
    if (isSupabaseConfigured && supabase && session?.id) {
      const { error } = await supabase
        .from('shop_products')
        .update({ is_active: next })
        .eq('id', id)
        .eq('shop_owner_id', session.id);
      if (!error) await loadProducts();
      return;
    }
    setList((L) => L.map((p) => (p.id === id ? { ...p, active: next } : p)));
  };

  const categoryOptions = useMemo(() => {
    const set = new Set(list.map((p) => p.category).filter(Boolean));
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [list]);

  const filtered = useMemo(() => {
    let a = list.filter((p) => (cat === 'All' || p.category === cat) && productMatchesSearch(p, q));
    if (stockF === 'in') a = a.filter((p) => p.stock > 0);
    if (stockF === 'out') a = a.filter((p) => p.stock === 0);
    a = [...a];
    if (sort === SORTS[0]) a.sort((x, y) => x.name.localeCompare(y.name));
    if (sort === SORTS[1]) a.sort((x, y) => y.name.localeCompare(x.name));
    if (sort === SORTS[2]) a.sort((x, y) => x.price - y.price);
    if (sort === SORTS[3]) a.sort((x, y) => y.price - x.price);
    if (sort === SORTS[4]) a.sort((x, y) => x.stock - y.stock);
    return a;
  }, [list, q, cat, stockF, sort]);

  return (
    <div className="soprd-page">
      <div className="soprd-head">
        <h1>My Products</h1>
        <div className="soprd-head-actions">
          <button type="button" className="soprd-btn-refresh" onClick={() => loadProducts()} disabled={loading}>
            Refresh
          </button>
          <button
            type="button"
            className="soprd-btn-add"
            onClick={() => navigate('/shop-owner/products/new')}
            aria-label="Add product"
          >
            <IcPlus /> Add Product
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="soprd-error" role="alert">
          <p>{loadError}</p>
        </div>
      ) : null}

      {adminAlerts.length > 0 ? (
        <div className="soprd-admin-alerts" role="region" aria-label="Admin notices">
          {adminAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`soprd-admin-alert${alert.adminAction === 'admin_product_deleted' ? ' soprd-admin-alert--product' : ' soprd-admin-alert--image'}`}
              role="alert"
            >
              <div className="soprd-admin-alert-body">
                <strong>{alert.title}</strong>
                <p>{alert.sub}</p>
                <span className="soprd-admin-alert-time">{alert.ago}</span>
              </div>
              <button
                type="button"
                className="soprd-admin-alert-dismiss"
                onClick={() => dismissAdminAlert(alert.id)}
                aria-label="Dismiss notice"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="soprd-filters">
        <div className="soprd-search-wrap">
          <IcSearch />
          <input
            className="soprd-search"
            placeholder="Search products..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search products"
          />
        </div>
        <div className="soprd-select-wrap">
          <select className="soprd-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="soprd-select-arrow" aria-hidden>
            <IcChevronDown />
          </span>
        </div>
        <div className="soprd-select-wrap">
          <select className="soprd-select" value={stockF} onChange={(e) => setStockF(e.target.value)} aria-label="Stock status">
            {STOCK_FILT.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="soprd-select-arrow" aria-hidden>
            <IcChevronDown />
          </span>
        </div>
      </div>

      <div className="soprd-sort-row">
        <div className="soprd-sort-wrap">
          <select className="soprd-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="soprd-select-arrow" aria-hidden>
            <IcChevronDown />
          </span>
        </div>
      </div>

      <div className="soprd-list">
        {loading ? (
          <p className="soprd-loading">Loading products…</p>
        ) : null}
        {!loading && filtered.length === 0 ? (
          <p className="soprd-empty">
            No products yet. Use <strong>Add Product</strong> to create your first item (saved to Supabase when
            configured).
          </p>
        ) : null}
        {!loading &&
          filtered.map((p) => {
            const oos = p.stock === 0;
            const low = p.stock > 0 && p.stock < 5;
            return (
              <article key={p.id} className="soprd-card">
                <div className="soprd-card-top">
                  <div className="soprd-thumb">
                    {p.primaryImageUrl ? (
                      <img src={p.primaryImageUrl} alt="" />
                    ) : (
                      <IcCamera />
                    )}
                  </div>
                  <div className="soprd-info">
                    <h2 className="soprd-name">{p.name}</h2>
                    <span className="soprd-cat">{p.category}</span>
                    <p className="soprd-price">{formatGBP(p.price)}</p>
                    <p className={`soprd-stock${oos ? ' soprd-stock--out' : ' soprd-stock--in'}`}>
                      {oos ? 'Out of stock' : `${p.stock} in stock`}
                    </p>
                    {low ? <span className="soprd-badge-low">Low stock</span> : null}
                  </div>
                </div>
                <div className="soprd-card-foot">
                  <div className="soprd-icon-btns">
                    <button
                      type="button"
                      className="soprd-icon-btn soprd-icon-btn--edit"
                      aria-label="Edit"
                      onClick={() => openEdit(p)}
                    >
                      <IcEdit />
                    </button>
                    <button
                      type="button"
                      className="soprd-icon-btn soprd-icon-btn--delete"
                      aria-label="Delete"
                      onClick={() => openDeletePrompt(p)}
                    >
                      <IcTrash />
                    </button>
                  </div>
                  <div className="soprd-active-wrap">
                    <span className="soprd-active-label">Active</span>
                    <button
                      type="button"
                      className={p.active ? 'soprd-toggle soprd-toggle--on' : 'soprd-toggle'}
                      aria-pressed={p.active}
                      aria-label={p.active ? 'Deactivate' : 'Activate'}
                      onClick={() => toggleA(p.id)}
                    />
                  </div>
                </div>
              </article>
            );
          })}
      </div>
      {editId && (
        <div className="sopOvl sopOvl--on" onClick={closeP} style={{ zIndex: 250 }} role="presentation" />
      )}
      <div
        className={editId ? 'sopPan sopPan--on sopPanWide' : 'sopPan sopPanWide'}
        role="dialog"
        aria-modal="true"
        aria-label="Edit product"
        style={{ zIndex: 300 }}
      >
        {editId && (
          <>
            <div className="sopPanH" style={{ alignItems: 'flex-start' }}>
              <h2>Edit product</h2>
              <button type="button" className="sopI2" onClick={closeP} style={{ lineHeight: 1 }} aria-label="Close">
                ✕
              </button>
            </div>
            <form className="sopPanB sopPanForm" onSubmit={save}>
              <input
                ref={fileEditRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: 'none' }}
                aria-hidden
                tabIndex={-1}
                onChange={onFileEditChange}
              />
              <p className="sopL">Product images</p>
              <div
                className="sopDz2 sopDzPr"
                style={{
                  position: 'relative',
                  width: '100%',
                  cursor: imageEditBusy ? 'wait' : 'pointer',
                  padding: images[0] ? 0 : undefined,
                  overflow: 'hidden',
                  minHeight: '5.5rem',
                }}
                onClick={() => !imageEditBusy && pickSlotEdit(0)}
                onKeyDown={(e) => {
                  if (imageEditBusy) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pickSlotEdit(0);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={images[0] ? 'Change primary product image' : 'Upload primary product image'}
              >
                {images[0] ? (
                  <img src={images[0].dataUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover' }} />
                ) : (
                  <span style={{ display: 'block', padding: '0.5rem' }}>
                    {imageEditBusy ? 'Processing…' : 'Tap to upload primary image'}
                  </span>
                )}
                {images[0] ? (
                  <button
                    type="button"
                    className="sopImgRm"
                    onClick={(e) => {
                      e.stopPropagation();
                      rmSlot(0);
                    }}
                    aria-label="Remove primary image"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <div className="sopDzR">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="sopDzSm"
                    style={{ cursor: imageEditBusy ? 'wait' : 'pointer', padding: images[i] ? 0 : undefined }}
                    onClick={() => !imageEditBusy && pickSlotEdit(i)}
                    onKeyDown={(e) => {
                      if (imageEditBusy) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pickSlotEdit(i);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={images[i] ? `Change extra image ${i}` : `Add extra image ${i}`}
                  >
                    {images[i] ? (
                      <img src={images[i].dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span>+{i + 1}</span>
                    )}
                    {images[i] ? (
                      <button
                        type="button"
                        className="sopImgRm"
                        onClick={(e) => {
                          e.stopPropagation();
                          rmSlot(i);
                        }}
                        aria-label={`Remove image ${i}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.68rem', color: '#888', margin: '0.1rem 0' }}>
                Up to 5 images. JPEG, PNG, WebP, or GIF — max 12 MB each.
              </p>
              <label className="sopL" htmlFor="p-name">Product name</label>
              <input
                className="sopI"
                id="p-name"
                value={f.name}
                onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
                required
              />
              <label className="sopL" htmlFor="p-cat">Category</label>
              <ProductCategoryField
                id="p-cat"
                value={f.category}
                onChange={(category) => setF((x) => ({ ...x, category }))}
                selectClassName="sopSel"
                inputClassName="sopI"
              />
              <label className="sopL" htmlFor="p-brand">Brand name (optional)</label>
              <input
                className="sopI"
                id="p-brand"
                value={f.brandName}
                onChange={(e) => setF((x) => ({ ...x, brandName: e.target.value }))}
                placeholder="e.g. Nike, Samsung"
                maxLength={80}
              />
              <label className="sopL" htmlFor="p-tags">Search tags</label>
              <ProductTagsInput
                id="p-tags"
                className="pti--compact"
                tags={f.tags}
                category={f.category}
                onChange={(tags) => setF((x) => ({ ...x, tags }))}
              />
              <label className="sopL" htmlFor="p-desc">Description</label>              <textarea
                id="p-desc"
                value={f.description}
                onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
                placeholder="Describe the product"
              />
              <label className="sopL" htmlFor="p-price">Price (USD)</label>
              <input
                className="sopI"
                id="p-price"
                type="number"
                min="0"
                step="0.01"
                value={f.price}
                onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))}
                required
              />
              <label className="sopL" htmlFor="p-cmp">Original price — put on sale (optional)</label>
              <input
                className="sopI"
                id="p-cmp"
                type="number"
                min="0"
                step="0.01"
                placeholder="Was / MSRP — higher than price"
                value={f.compare}
                onChange={(e) => setF((x) => ({ ...x, compare: e.target.value }))}
              />
              <label className="sopRow" style={{ margin: '0.35rem 0', alignItems: 'center', gap: 8 }}>
                <input
                  id="p-free-del"
                  type="checkbox"
                  checked={f.offersFreeDelivery}
                  onChange={(e) => setF((x) => ({ ...x, offersFreeDelivery: e.target.checked }))}
                />
                <span className="sopL" style={{ margin: 0 }}>Offer free delivery on this product</span>
              </label>
              <label className="sopL" htmlFor="p-st">Stock quantity</label>
              <input
                className="sopI"
                id="p-st"
                type="number"
                min="0"
                value={f.stock}
                onChange={(e) => setF((x) => ({ ...x, stock: e.target.value }))}
              />
              <label className="sopL" htmlFor="p-sku">SKU / product code (optional)</label>
              <input className="sopI" id="p-sku" value={f.sku} onChange={(e) => setF((x) => ({ ...x, sku: e.target.value }))} />
              <label className="sopL" htmlFor="p-w">Weight (for delivery)</label>
              <input
                className="sopI"
                id="p-w"
                type="text"
                placeholder="e.g. 0.5 kg"
                value={f.weight}
                onChange={(e) => setF((x) => ({ ...x, weight: e.target.value }))}
              />
              <div className="sopRow" style={{ margin: '0.3rem 0' }}>
                <span className="sopL" style={{ margin: 0 }}>Has variants?</span>
                <button
                  type="button"
                  className={f.hasVariants ? 'sopTgl2 sopTgl2--on' : 'sopTgl2'}
                  style={{ position: 'relative' }}
                  aria-pressed={f.hasVariants}
                  onClick={() => setF((x) => ({ ...x, hasVariants: !x.hasVariants }))}
                />
              </div>
              {f.hasVariants && (
                <div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '0.2rem 0' }}>
                    <select className="sopSelS" value={vType} onChange={(e) => setVType(e.target.value)} aria-label="Variant type">
                      <option>Size</option>
                      <option>Color</option>
                      <option>Style</option>
                    </select>
                    <input className="sopI" style={{ flex: '1 1 5rem', minWidth: 0 }} placeholder="Name" value={vName} onChange={(e) => setVName(e.target.value)} />
                    <input className="sopI" style={{ flex: '0 0 4.5rem' }} placeholder="Price" value={vPrice} onChange={(e) => setVPrice(e.target.value)} type="number" step="0.01" />
                    <input className="sopI" style={{ flex: '0 0 4.5rem' }} placeholder="Stock" value={vStock} onChange={(e) => setVStock(e.target.value)} type="number" />
                    <button type="button" className="sopBsm" onClick={addVar} style={{ alignSelf: 'center' }}>Add variant</button>
                  </div>
                  {f.variants.map((v, j) => (
                    <div key={j} className="sopVarB">
                      {v.type}: {v.name} — {formatGBP(v.price)} / {v.stock} in stock
                    </div>
                  ))}
                </div>
              )}
              <div className="sopRow" style={{ margin: '0.35rem 0' }}>
                <span className="sopL" style={{ margin: 0 }}>Product is active</span>
                <button
                  type="button"
                  className={f.active ? 'sopTgl2 sopTgl2--on' : 'sopTgl2'}
                  style={{ position: 'relative' }}
                  aria-pressed={f.active}
                  onClick={() => setF((x) => ({ ...x, active: !x.active }))}
                />
              </div>
              {f.compare && f.price && (
                <p style={{ fontSize: '0.75rem', color: '#888' }}>
                  On sale: <s>{formatGBP(parseFloat(f.compare))}</s> now {formatGBP(parseFloat(f.price))}
                </p>
              )}
              {editError ? (
                <p role="alert" style={{ color: '#c62828', fontSize: '0.82rem', fontWeight: 600, margin: '0.35rem 0 0' }}>
                  {editError}
                </p>
              ) : null}
              <div className="sopFootBtns">
                <button type="submit" className="sopBtn2" style={{ flex: 1, margin: 0 }}>
                  Save product
                </button>
                <button type="button" className="sopBtnO" onClick={closeP} style={{ flex: 1 }}>
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {deletePrompt ? (
        <>
          <div className="sopDelOvl" onClick={() => !deleteBusy && setDeletePrompt(null)} role="presentation" />
          <div className="sopDelCard" role="dialog" aria-modal="true" aria-labelledby="sop-del-title">
            <div className="sopDelIconWrap" aria-hidden>
              <IcTrash />
            </div>
            <h2 id="sop-del-title" className="sopDelTitle">
              Remove this product?
            </h2>
            <p className="sopDelText">
              <strong>{deletePrompt.name}</strong> will be permanently removed from your catalog. This cannot be undone.
            </p>
            <div className="sopDelActions">
              <button type="button" className="sopDelBtn sopDelBtn--ghost" disabled={deleteBusy} onClick={() => setDeletePrompt(null)}>
                Cancel
              </button>
              <button type="button" className="sopDelBtn sopDelBtn--danger" disabled={deleteBusy} onClick={confirmDelete}>
                {deleteBusy ? 'Removing…' : 'Delete product'}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {toast ? (
        <div className={`sopToast sopToast--${toast.type}`} role="status">
          {toast.type === 'success' ? (
            <span className="sopToastIcon" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ) : (
            <span className="sopToastIcon sopToastIcon--err" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v5M12 16h.01M10.3 3.2h3.4L21 18.8H3L10.3 3.2Z" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          <span className="sopToastMsg">{toast.message}</span>
          <button type="button" className="sopToastClose" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
