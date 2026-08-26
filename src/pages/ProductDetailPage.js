import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { mapRowsToCustomerProducts, mapShopOwnerToCard } from '../lib/customerShopMap';
import { recordProductDwell, recordProductView } from '../lib/shopUserBehavior';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './productDetailPremium.css';

const DETAIL_COLUMNS =
  'id, shop_owner_id, name, category, brand_name, description, price, compare_at_price, stock, sku, is_active, offers_free_delivery, image_primary_url, image_urls, tags, created_at';

const DETAIL_COLUMNS_FALLBACK =
  'id, shop_owner_id, name, category, description, price, compare_at_price, stock, sku, is_active, image_primary_url, image_urls, tags';

const RELATED_COLUMNS =
  'id, shop_owner_id, name, category, brand_name, price, compare_at_price, stock, is_active, offers_free_delivery, image_primary_url, tags, created_at';

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M15.5 19.5L8 12l7.5-7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M6.5 7H20l-1.3 6.6a1.2 1.2 0 0 1-1.1 1H7.2a1.1 1.1 0 0 1-1.1-.7L4.2 3H2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="9" cy="19" r="1" fill="currentColor" />
      <circle cx="16" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}

function formatP(p) {
  return FMT.format(p);
}

function sanitizeUrl(url) {
  if (!url || String(url).startsWith('data:') || String(url).length > 2048) return '';
  return String(url);
}

function RelatedCard({ product, onOpen }) {
  return (
    <button type="button" className="pdp-related__card" onClick={() => onOpen(product)}>
      {product.imageUrl ? (
        <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="pdp-related__ph" aria-hidden />
      )}
      <div className="pdp-related__body">
        <p className="pdp-related__name">{product.name}</p>
        {product.brandName ? <p className="pdp-related__brand">{product.brandName}</p> : null}
        <div className="pdp-related__priceRow">
          <span className="pdp-related__price">{formatP(product.price)}</span>
          {product.compareAt ? <span className="pdp-related__was">{formatP(product.compareAt)}</span> : null}
        </div>
        <p className="pdp-related__shop">{product.shopName}</p>
      </div>
    </button>
  );
}

export default function ProductDetailPage() {
  const { shopId, productId } = useParams();
  const navigate = useNavigate();
  const { addToCart, totalCount, subtotal } = useShopCart();
  const [product, setProduct] = useState(null);
  const [shop, setShop] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeImg, setActiveImg] = useState(0);
  const [addedFlash, setAddedFlash] = useState(false);
  const viewStartedRef = useRef(null);

  useEffect(() => {
    if (!product?.id) return undefined;
    const pid = product.id;
    recordProductView(product);
    viewStartedRef.current = Date.now();
    return () => {
      if (viewStartedRef.current) {
        recordProductDwell(pid, Date.now() - viewStartedRef.current);
      }
    };
  }, [product]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setProduct(null);
    setShop(null);
    setRelated([]);
    setActiveImg(0);

    if (!shopId || !productId) {
      setError('Product not found.');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    try {
      const ownerPromise = supabase
        .from('shop_owners')
        .select('id, business_name, business_type, business_address, shop_image_url')
        .eq('id', shopId)
        .maybeSingle();

      let prodQuery = supabase
        .from('shop_products')
        .select(DETAIL_COLUMNS)
        .eq('id', productId)
        .eq('shop_owner_id', shopId)
        .eq('is_active', true)
        .maybeSingle();

      const [{ data: ownerRow, error: ownerErr }, prodRes] = await Promise.all([ownerPromise, prodQuery]);

      let prodRow = prodRes.data;
      let prodErr = prodRes.error;
      if (prodErr && /brand_name|offers_free_delivery|column|schema cache/i.test(prodErr.message || '')) {
        const retry = await supabase
          .from('shop_products')
          .select(DETAIL_COLUMNS_FALLBACK)
          .eq('id', productId)
          .eq('shop_owner_id', shopId)
          .eq('is_active', true)
          .maybeSingle();
        prodRow = retry.data;
        prodErr = retry.error;
      }

      if (ownerErr || !ownerRow) {
        setError(ownerErr?.message || 'Shop not found.');
        setLoading(false);
        return;
      }
      if (prodErr || !prodRow) {
        setError(prodErr?.message || 'Product not found.');
        setLoading(false);
        return;
      }

      const card = mapShopOwnerToCard(ownerRow);
      setShop(card);
      const mapped = mapRowsToCustomerProducts([prodRow], shopId, card.name)[0];
      if (!mapped) {
        setError('Product not found.');
        setLoading(false);
        return;
      }
      const gallery = [mapped.imageUrl, ...(mapped.imageUrls || [])]
        .map(sanitizeUrl)
        .filter(Boolean)
        .filter((u, i, arr) => arr.indexOf(u) === i);
      setProduct({ ...mapped, gallery });
      setLoading(false);

      // Related: same category / brand / shop — slim columns, limited.
      let relatedRows = null;
      let relErr = null;
      const rel = await supabase
        .from('shop_products')
        .select(RELATED_COLUMNS)
        .eq('is_active', true)
        .neq('id', productId)
        .order('created_at', { ascending: false })
        .limit(24);
      relatedRows = rel.data;
      relErr = rel.error;
      if (relErr && /brand_name|offers_free_delivery|column|schema cache/i.test(relErr.message || '')) {
        const retry = await supabase
          .from('shop_products')
          .select(
            'id, shop_owner_id, name, category, price, compare_at_price, stock, is_active, image_primary_url, tags',
          )
          .eq('is_active', true)
          .neq('id', productId)
          .order('name', { ascending: true })
          .limit(24);
        relatedRows = retry.data;
        relErr = retry.error;
      }

      if (!relErr && relatedRows?.length) {
        const shopIds = [...new Set(relatedRows.map((r) => r.shop_owner_id).filter(Boolean))];
        const nameById = { [shopId]: card.name };
        if (shopIds.some((id) => id !== shopId)) {
          const { data: shops } = await supabase
            .from('shop_owners')
            .select('id, business_name')
            .in(
              'id',
              shopIds.filter((id) => id !== shopId),
            );
          for (const s of shops || []) nameById[s.id] = s.business_name?.trim() || 'Shop';
        }
        const scored = [];
        for (const row of relatedRows) {
          const item = mapRowsToCustomerProducts(
            [row],
            row.shop_owner_id,
            nameById[row.shop_owner_id] || 'Shop',
          )[0];
          if (!item) continue;
          if (item.imageUrl && (item.imageUrl.startsWith('data:') || item.imageUrl.length > 2048)) {
            item.imageUrl = '';
          }
          let score = 0;
          if (item.shopId === shopId) score += 3;
          if (
            mapped.category &&
            String(item.category).toLowerCase() === String(mapped.category).toLowerCase()
          ) {
            score += 2;
          }
          if (
            mapped.brandName &&
            item.brandName &&
            String(item.brandName).toLowerCase() === String(mapped.brandName).toLowerCase()
          ) {
            score += 2;
          }
          if (item.onSale) score += 1;
          if (item.imageUrl) score += 1;
          scored.push({ item, score });
        }
        scored.sort((a, b) => b.score - a.score);
        setRelated(scored.slice(0, 8).map((s) => s.item));
      }
    } catch (err) {
      setError(err?.message || 'Could not load product.');
      setLoading(false);
    }
  }, [shopId, productId]);

  useEffect(() => {
    load();
  }, [load]);

  const gallery = useMemo(() => product?.gallery || [], [product]);

  const onAdd = () => {
    if (!product?.inStock) return;
    addToCart(product);
    setAddedFlash(true);
    window.setTimeout(() => setAddedFlash(false), 1600);
  };

  const openRelated = (p) => {
    navigate(`/shop/${p.shopId}/product/${p.id}`);
    window.scrollTo(0, 0);
  };

  if (loading) {
    return (
      <div className="pdp-page" role="main">
        <header className="pdp-nav">
          <button type="button" className="pdp-nav__back" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon />
          </button>
          <h1 className="pdp-nav__title">Product</h1>
          <Link to="/shop/cart" className="pdp-nav__cart" aria-label={`Cart, ${totalCount} items`}>
            <CartIcon />
            {totalCount > 0 ? <span className="pdp-badge">{totalCount > 99 ? '99+' : totalCount}</span> : null}
          </Link>
        </header>
        <div className="pdp-skeleton" aria-busy="true" aria-label="Loading product">
          <div className="pdp-skeleton__media" />
          <div className="pdp-skeleton__line" />
          <div className="pdp-skeleton__line pdp-skeleton__line--short" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="pdp-page" role="main">
        <header className="pdp-nav">
          <button type="button" className="pdp-nav__back" onClick={() => navigate('/shops')} aria-label="Back">
            <BackIcon />
          </button>
          <h1 className="pdp-nav__title">Product</h1>
          <span aria-hidden />
        </header>
        <p className="pdp-status pdp-status--err" role="alert">
          {error || 'Product not found.'}
        </p>
        <button type="button" className="pdp-linkBtn" onClick={() => navigate('/shops')}>
          Back to marketplace
        </button>
      </div>
    );
  }

  return (
    <div className="pdp-page" role="main">
      <header className="pdp-nav">
        <button
          type="button"
          className="pdp-nav__back"
          onClick={() => navigate(`/shop/${shopId}`)}
          aria-label="Back to shop"
        >
          <BackIcon />
        </button>
        <h1 className="pdp-nav__title">Item details</h1>
        <Link to="/shop/cart" className="pdp-nav__cart" aria-label={`Cart, ${totalCount} items`}>
          <CartIcon />
          {totalCount > 0 ? <span className="pdp-badge">{totalCount > 99 ? '99+' : totalCount}</span> : null}
        </Link>
      </header>

      <div className="pdp-scroll">
        <section className="pdp-gallery" aria-label="Product photos">
          <div className="pdp-gallery__main">
            {gallery[activeImg] ? (
              <img src={gallery[activeImg]} alt={product.name} decoding="async" />
            ) : (
              <div className="pdp-gallery__ph" aria-hidden>
                No photo
              </div>
            )}
            {product.onSale ? (
              <span className="pdp-saleBadge">
                {product.percentOff ? `${product.percentOff}% off` : 'Sale'}
              </span>
            ) : null}
            {product.offersFreeDelivery ? <span className="pdp-freeBadge">Free delivery</span> : null}
          </div>
          {gallery.length > 1 ? (
            <div className="pdp-thumbs">
              {gallery.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  className={`pdp-thumb${activeImg === i ? ' pdp-thumb--on' : ''}`}
                  onClick={() => setActiveImg(i)}
                  aria-label={`Photo ${i + 1}`}
                  aria-pressed={activeImg === i}
                >
                  <img src={src} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="pdp-info">
          {product.brandName ? <p className="pdp-brand">{product.brandName}</p> : null}
          <h2 className="pdp-title">{product.name}</h2>
          <button type="button" className="pdp-shopLink" onClick={() => navigate(`/shop/${shopId}`)}>
            Sold by <strong>{shop?.name || product.shopName}</strong>
          </button>

          <div className="pdp-priceBlock">
            <span className="pdp-price">{formatP(product.price)}</span>
            {product.compareAt ? (
              <>
                <span className="pdp-was">{formatP(product.compareAt)}</span>
                {product.percentOff ? <span className="pdp-off">{product.percentOff}% off</span> : null}
              </>
            ) : null}
          </div>

          <p className={`pdp-stock${product.inStock ? '' : ' pdp-stock--out'}`}>
            {product.inStock ? (product.stock <= 5 ? `Only ${product.stock} left` : 'In stock') : 'Out of stock'}
          </p>

          <div className="pdp-meta">
            {product.category ? <span className="pdp-chip">{product.category}</span> : null}
            {product.offersFreeDelivery ? <span className="pdp-chip pdp-chip--green">Free delivery</span> : null}
          </div>

          <button
            type="button"
            className={`pdp-add${addedFlash ? ' pdp-add--flash' : ''}`}
            disabled={!product.inStock}
            onClick={onAdd}
          >
            {addedFlash ? 'Added to cart ✓' : product.inStock ? 'Add to cart' : 'Unavailable'}
          </button>

          {product.description ? (
            <div className="pdp-desc">
              <h3 className="pdp-desc__title">About this item</h3>
              <p className="pdp-desc__text">{product.description}</p>
            </div>
          ) : null}

          {product.tags?.length ? (
            <div className="pdp-tags">
              {product.tags.map((t) => (
                <span key={t} className="pdp-tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {related.length > 0 ? (
          <section className="pdp-related" aria-label="More like this">
            <h3 className="pdp-related__title">More like this</h3>
            <div className="pdp-related__grid">
              {related.map((p) => (
                <RelatedCard key={p.id} product={p} onOpen={openRelated} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {totalCount > 0 ? (
        <Link to="/shop/cart" className="pdp-cbar" aria-label={`View cart, ${totalCount} items`}>
          <span>
            View Cart — {totalCount} {totalCount === 1 ? 'item' : 'items'}
          </span>
          <span>{formatP(subtotal)}</span>
        </Link>
      ) : null}
    </div>
  );
}
