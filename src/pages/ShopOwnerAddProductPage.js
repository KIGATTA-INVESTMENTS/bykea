import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ProductCategoryField from '../components/shopOwner/ProductCategoryField';
import ProductTagsInput from '../components/shopOwner/ProductTagsInput';
import { formatGBP } from '../lib/currency';
import { compressImageToDataUrl } from '../lib/compressImageToDataUrl';
import { normalizeProductCategory, normalizeProductTags } from '../lib/shopProductCategories';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { resolveShopMediaUrl } from '../lib/shopMediaUpload';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerDashboardPremium.css';
import './shopOwnerAddProductPremium.css';

const MAX_FILE_BYTES = 12 * 1024 * 1024;

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

function IcCamera() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" aria-hidden className="soap-upload-icon">
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

function IcTag() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M4 12.5V5.8a.8.8 0 0 1 .2-.1h6.3l8.2 8.2a.8.8 0 0 1 0 1.1l-4.6 4.6a.8.8 0 0 1-1.1 0L4 12.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="1.25" fill="currentColor" />
    </svg>
  );
}

function IcCategory() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IcDoc() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M8 4h8l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M16 4v4h4M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcCurrency() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v10M9.5 9.5c0-1.1 1.1-2 2.5-2s2.5.9 2.5 2-1.1 2-2.5 2-2.5.9-2.5 2 1.1 2 2.5 2 2.5-.9 2.5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcBox() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 12v8M4 8.5l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IcBarcode() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path d="M5 6v12M8 6v12M11 6v12M14 6v12M17 6v12M20 6v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcWeight() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path d="M12 3v3M8 8h8l-1 10H9L8 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 21h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function ShopOwnerAddProductPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const slotPickerRef = useRef(0);
  const [f, setF] = useState(() => emptyForm());
  const [images, setImages] = useState([null, null, null, null, null]);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [vType, setVType] = useState('Size');
  const [vName, setVName] = useState('');
  const [vPrice, setVPrice] = useState('');
  const [vStock, setVStock] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pickSlot = (i) => {
    setImageError('');
    slotPickerRef.current = i;
    fileInputRef.current?.click();
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageError('');
    if (!file.type.startsWith('image/')) {
      setImageError('Please choose an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setImageError('Image is too large. Maximum size is 12 MB.');
      return;
    }
    const i = slotPickerRef.current;
    setImageBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file, 960, 0.78);
      setImages((m) => {
        const n = [...m];
        n[i] = { dataUrl, name: file.name, file };
        return n;
      });
    } catch (err) {
      setImageError(err?.message || 'Could not process this image.');
    } finally {
      setImageBusy(false);
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
    setSubmitError('');
    const price = parseFloat(f.price) || 0;
    const st = parseInt(f.stock, 10);
    const session = getShopOwnerSession();
    if (!session?.id) {
      setSubmitError('You must be logged in as a shop owner to save products.');
      return;
    }

    if (isSupabaseConfigured && supabase) {
      setSubmitting(true);
      try {
        const productKey = `new_${Date.now()}`;
        const slots = await Promise.all(
          [0, 1, 2, 3, 4].map((idx) => {
            const slot = images[idx];
            if (!slot) return Promise.resolve(null);
            return resolveShopMediaUrl({
              ownerId: session.id,
              productKey,
              slotIndex: idx,
              file: slot.file || null,
              url: slot.dataUrl || null,
            });
          }),
        );
        const primaryUrl = slots[0] || null;
        const galleryUrls = slots.slice(1).filter(Boolean);
        const tags = normalizeProductTags(f.tags);

        const row = {
          shop_owner_id: session.id,
          name: f.name.trim() || 'New product',
          category: normalizeProductCategory(f.category),
          brand_name: f.brandName.trim() || null,
          description: f.description.trim() || null,
          price,
          compare_at_price: f.compare ? parseFloat(f.compare) : null,
          stock: Number.isFinite(st) ? st : 0,
          sku: f.sku.trim() || null,
          weight: f.weight.trim() || null,
          currency: 'USD',
          is_active: f.active,
          offers_free_delivery: Boolean(f.offersFreeDelivery),
          has_variants: f.hasVariants,
          variants: f.variants,
          image_primary_url: primaryUrl,
          image_urls: galleryUrls,
          tags,
        };
        let { error } = await supabase.from('shop_products').insert(row);
        if (error && /brand_name|offers_free_delivery|schema cache/i.test(error.message || '')) {
          const { brand_name: _b, offers_free_delivery: _f, ...withoutMarketplace } = row;
          ({ error } = await supabase.from('shop_products').insert(withoutMarketplace));
        }
        if (error && /tags|column|schema cache/i.test(error.message || '')) {
          const { tags: _omit, brand_name: _b2, offers_free_delivery: _f2, ...withoutTags } = row;
          ({ error } = await supabase.from('shop_products').insert(withoutTags));
        }
        if (error) {
          setSubmitError(
            error.message.includes('row-level security') || error.message.includes('shop_products')
              ? `${error.message} — Run supabase/shop_products.sql (and shop_products_marketplace.sql) in Supabase.`
              : error.message,
          );
          return;
        }
        navigate('/shop-owner/products', { replace: true, state: { refreshProducts: true } });
      } catch {
        setSubmitError('Network error while saving. Try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const product = {
      id: String(Date.now()),
      name: f.name.trim() || 'New product',
      category: f.category,
      price,
      stock: Number.isFinite(st) ? st : 0,
      active: f.active,
      primaryImageUrl: images[0]?.dataUrl ?? null,
      galleryImageUrls: [1, 2, 3, 4].map((idx) => images[idx]?.dataUrl).filter(Boolean),
    };
    navigate('/shop-owner/products', { replace: true, state: { addedProduct: product } });
  };

  const primaryClass = [
    'soap-upload-primary',
    imageBusy ? 'soap-upload-primary--busy' : '',
    images[0] ? 'soap-upload-primary--filled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="soap-page">
      <header className="soap-head">
        <Link to="/shop-owner/products" className="soap-back">
          ← Back to products
        </Link>
        <h1>Add Product</h1>
        <p className="soap-sub">Fill in the details below, then save to list this item.</p>
      </header>

      <form className="soap-form" onSubmit={save}>
        {submitError ? (
          <p className="soap-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }}
          aria-hidden
          tabIndex={-1}
          onChange={onFileChange}
        />

        <section className="soap-card" aria-labelledby="soap-images-title">
          <h2 id="soap-images-title" className="soap-card-title">
            Product Images
          </h2>
          {imageError ? (
            <p className="soap-img-error" role="alert">
              {imageError}
            </p>
          ) : null}
          <div
            className={primaryClass}
            onClick={() => !imageBusy && pickSlot(0)}
            onKeyDown={(e) => {
              if (imageBusy) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pickSlot(0);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={images[0] ? 'Change primary product image' : 'Upload primary product image'}
          >
            {images[0] ? (
              <img src={images[0].dataUrl} alt="" />
            ) : (
              <>
                <IcCamera />
                <span className="soap-upload-title">{imageBusy ? 'Processing…' : 'Tap to upload primary image'}</span>
                <p className="soap-upload-hint">JPEG, PNG, WebP, or GIF — max 12MB</p>
              </>
            )}
            {images[0] ? (
              <button
                type="button"
                className="soap-img-rm"
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
          <div className="soap-slots">
            {[1, 2, 3, 4].map((i) => {
              const slotClass = [
                'soap-slot',
                imageBusy ? 'soap-slot--busy' : '',
                images[i] ? 'soap-slot--filled' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={i}
                  className={slotClass}
                  onClick={() => !imageBusy && pickSlot(i)}
                  onKeyDown={(e) => {
                    if (imageBusy) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pickSlot(i);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={images[i] ? `Change extra image ${i}` : `Add extra image ${i}`}
                >
                  {images[i] ? (
                    <img src={images[i].dataUrl} alt="" />
                  ) : (
                    <>
                      <span className="soap-slot-plus" aria-hidden>
                        +
                      </span>
                      <span className="soap-slot-label">+{i + 1}</span>
                    </>
                  )}
                  {images[i] ? (
                    <button
                      type="button"
                      className="soap-img-rm"
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
              );
            })}
          </div>
        </section>

        <section className="soap-card" aria-label="Product details">
          <div className="soap-group">
            <p className="soap-group-label">Product Info</p>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-name">
                Product Name
              </label>
              <div className="soap-input-wrap">
                <span className="soap-iconbox" aria-hidden>
                  <IcTag />
                </span>
                <input
                  className="soap-input"
                  id="ap-name"
                  value={f.name}
                  onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-cat">
                Category
              </label>
              <div className="soap-input-wrap soap-input-wrap--stack">
                <span className="soap-iconbox" aria-hidden>
                  <IcCategory />
                </span>
                <ProductCategoryField
                  id="ap-cat"
                  value={f.category}
                  onChange={(category) => setF((x) => ({ ...x, category }))}
                />
              </div>
              <p className="soap-field-hint">Pick a matching category, or choose Custom category…</p>
            </div>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-brand">
                Brand name <span className="soap-label-optional">(optional — customers can shop by brand)</span>
              </label>
              <div className="soap-input-wrap">
                <span className="soap-iconbox" aria-hidden>
                  <IcTag />
                </span>
                <input
                  className="soap-input"
                  id="ap-brand"
                  value={f.brandName}
                  onChange={(e) => setF((x) => ({ ...x, brandName: e.target.value }))}
                  placeholder="e.g. Nike, Samsung, Local Farm"
                  maxLength={80}
                />
              </div>
            </div>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-tags">
                Search tags <span className="soap-label-optional">(helps customers find this)</span>
              </label>
              <ProductTagsInput
                id="ap-tags"
                tags={f.tags}
                category={f.category}
                onChange={(tags) => setF((x) => ({ ...x, tags }))}
              />
            </div>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-desc">
                Description <span className="soap-label-optional">(optional)</span>
              </label>
              <div className="soap-input-wrap soap-input-wrap--textarea">
                <span className="soap-iconbox" aria-hidden style={{ alignSelf: 'flex-start', paddingTop: '0.85rem' }}>
                  <IcDoc />
                </span>
                <textarea
                  id="ap-desc"
                  className="soap-textarea"
                  value={f.description}
                  onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
                  placeholder="Describe the product"
                />
              </div>
            </div>
          </div>

          <div className="soap-group">
            <p className="soap-group-label">Pricing</p>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-price">
                Price (USD)
              </label>
              <div className="soap-input-wrap">
                <span className="soap-iconbox soap-iconbox--blue" aria-hidden>
                  �$
                </span>
                <input
                  className="soap-input"
                  id="ap-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={f.price}
                  onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-cmp">
                Original price (on sale) <span className="soap-label-optional">(optional — like Etsy)</span>
              </label>
              <div className="soap-input-wrap">
                <span className="soap-iconbox" aria-hidden>
                  <IcCurrency />
                </span>
                <input
                  className="soap-input"
                  id="ap-cmp"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Was / MSRP — must be higher than price"
                  value={f.compare}
                  onChange={(e) => setF((x) => ({ ...x, compare: e.target.value }))}
                />
              </div>
              <p className="soap-field-hint">
                Set this higher than Price to put the item on sale. Customers see a Sale badge and strikethrough.
              </p>
            </div>

            {f.compare && f.price ? (
              <p className="soap-compare-note">
                On sale: <s>{formatGBP(parseFloat(f.compare))}</s> now {formatGBP(parseFloat(f.price))}
              </p>
            ) : null}

            <div className="soap-field">
              <label className="soap-row-check" htmlFor="ap-free-del">
                <input
                  id="ap-free-del"
                  type="checkbox"
                  checked={f.offersFreeDelivery}
                  onChange={(e) => setF((x) => ({ ...x, offersFreeDelivery: e.target.checked }))}
                />
                <span>Offer free delivery on this product</span>
              </label>
            </div>
          </div>

          <div className="soap-group">
            <p className="soap-group-label">Inventory</p>

            <div className="soap-field">
              <label className="soap-label" htmlFor="ap-st">
                Stock Quantity
              </label>
              <div className="soap-input-wrap">
                <span className="soap-iconbox" aria-hidden>
                  <IcBox />
                </span>
                <input
                  className="soap-input"
                  id="ap-st"
                  type="number"
                  min="0"
                  value={f.stock}
                  onChange={(e) => setF((x) => ({ ...x, stock: e.target.value }))}
                />
              </div>
            </div>

          </div>

          <div className="soap-group">
            <p className="soap-group-label">Listing</p>
            <div className="soap-row">
              <span className="soap-label">Product is active</span>
              <button
                type="button"
                className={f.active ? 'soap-tgl soap-tgl--on' : 'soap-tgl'}
                aria-pressed={f.active}
                onClick={() => setF((x) => ({ ...x, active: !x.active }))}
              />
            </div>
          </div>

          <details className="soap-more">
            <summary className="soap-more__summary">More options (SKU, weight, variants)</summary>
            <div className="soap-more__body">
              <div className="soap-field">
                <label className="soap-label" htmlFor="ap-sku">
                  SKU / Product Code <span className="soap-label-optional">(optional)</span>
                </label>
                <div className="soap-input-wrap">
                  <span className="soap-iconbox" aria-hidden>
                    <IcBarcode />
                  </span>
                  <input className="soap-input" id="ap-sku" value={f.sku} onChange={(e) => setF((x) => ({ ...x, sku: e.target.value }))} />
                </div>
              </div>

              <div className="soap-field">
                <label className="soap-label" htmlFor="ap-w">
                  Weight (for delivery)
                </label>
                <div className="soap-input-wrap">
                  <span className="soap-iconbox" aria-hidden>
                    <IcWeight />
                  </span>
                  <input
                    className="soap-input"
                    id="ap-w"
                    type="text"
                    placeholder="e.g. 0.5 kg"
                    value={f.weight}
                    onChange={(e) => setF((x) => ({ ...x, weight: e.target.value }))}
                  />
                </div>
              </div>

              <div className="soap-row">
                <span className="soap-label">Has variants?</span>
                <button
                  type="button"
                  className={f.hasVariants ? 'soap-tgl soap-tgl--on' : 'soap-tgl'}
                  aria-pressed={f.hasVariants}
                  onClick={() => setF((x) => ({ ...x, hasVariants: !x.hasVariants }))}
                />
              </div>

              {f.hasVariants && (
                <div className="soap-variants">
                  <div className="soap-variants-row">
                    <select className="soap-select-sm" value={vType} onChange={(e) => setVType(e.target.value)} aria-label="Variant type">
                      <option>Size</option>
                      <option>Color</option>
                      <option>Style</option>
                    </select>
                    <div className="soap-input-wrap" style={{ flex: '1 1 5rem' }}>
                      <input
                        className="soap-input"
                        placeholder="Name"
                        value={vName}
                        onChange={(e) => setVName(e.target.value)}
                        aria-label="Variant name"
                      />
                    </div>
                    <div className="soap-input-wrap soap-input-wrap--sm" style={{ flex: '0 0 4.5rem' }}>
                      <input
                        className="soap-input"
                        placeholder="Price"
                        value={vPrice}
                        onChange={(e) => setVPrice(e.target.value)}
                        type="number"
                        step="0.01"
                        aria-label="Variant price"
                      />
                    </div>
                    <div className="soap-input-wrap soap-input-wrap--sm" style={{ flex: '0 0 4.5rem' }}>
                      <input
                        className="soap-input"
                        placeholder="Stock"
                        value={vStock}
                        onChange={(e) => setVStock(e.target.value)}
                        type="number"
                        aria-label="Variant stock"
                      />
                    </div>
                    <button type="button" className="soap-btn-sm" onClick={addVar}>
                      Add variant
                    </button>
                  </div>
                  {f.variants.map((v, j) => (
                    <div key={j} className="soap-var-chip">
                      {v.type}: {v.name} — {formatGBP(parseFloat(v.price) || 0)} / {v.stock} in stock
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </section>

        <div className="soap-actions">
          <button type="submit" className="soap-save-btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Product'}
          </button>
          <Link to="/shop-owner/products" className="soap-cancel-link">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
