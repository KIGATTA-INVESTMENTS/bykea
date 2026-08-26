import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { mapRowsToCustomerProducts, mapShopOwnerToCard } from '../lib/customerShopMap';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './shopDetailPremium.css';

const POPULAR_LIMIT = 8;
const FILTER_ALL = 'all';
const FILTER_POPULAR = 'popular';

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
        d="M6 7h15l-1.5 9H8L6 7ZM9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6 7 5 3H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CartBarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M6 7h15l-1.5 9H8L6 7ZM9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6 7 5 3H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CartBadge({ count }) {
  if (!count || count < 1) return null;
  return (
    <span className="shpd-badge" aria-hidden>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function DeliveryTruckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M3 6.5h11v8H3v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 9.5h4l3 3v2h-7v-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="7" cy="17" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.5" cy="17" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function StorefrontIcon() {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden>
      <path
        d="M12 32V68h56V32L40 14 12 32Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        fill="rgba(255,255,255,0.08)"
      />
      <path d="M24 68V44h12v24M44 68V52h12v16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="30" y="38" width="20" height="14" rx="2" className="shpd-hero__art-accent" fill="#EC6C23" stroke="none" />
      <path d="M8 32h64" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="40" cy="22" r="6" fill="#EC6C23" opacity="0.9" />
    </svg>
  );
}

function ImagePlaceholderIcon() {
  return (
    <svg className="shpd-card__ph-icon" viewBox="0 0 24 24" width="36" height="36" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" />
      <path d="M3 16l5-4 4 3 3-2 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyCategoryIcon() {
  return (
    <svg className="shpd-empty__icon" viewBox="0 0 48 48" width="48" height="48" fill="none" aria-hidden>
      <rect x="8" y="12" width="32" height="26" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 20h32" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="24" cy="28" r="4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function stars(n) {
  return '★'.repeat(Math.max(0, Math.min(5, Math.floor(n) || 0)));
}

function formatP(p) {
  return FMT.format(p);
}

function formatCategoryLabel(c) {
  const s = String(c || 'Other').trim();
  if (!s) return 'Other';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Rank products for a “Popular” shelf: in-stock first, then with photos, then higher stock. */
function pickPopularProducts(products, limit = POPULAR_LIMIT) {
  return [...products]
    .sort((a, b) => {
      const stockScore = Number(b.inStock) - Number(a.inStock);
      if (stockScore) return stockScore;
      const imgScore = Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl));
      if (imgScore) return imgScore;
      return (Number(b.stock) || 0) - (Number(a.stock) || 0);
    })
    .slice(0, limit);
}

function ProductCard({ product, inCart, onAdd, onOpen }) {
  return (
    <article
      className="shpd-card"
      role="listitem"
      tabIndex={0}
      onClick={() => onOpen?.(product)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(product);
        }
      }}
    >
      <div className="shpd-card__media">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="shpd-card__ph">
            <ImagePlaceholderIcon />
          </div>
        )}
        {!product.inStock ? <span className="shpd-card__oos">Out of stock</span> : null}
        {product.onSale ? <span className="shpd-card__sale">Sale</span> : null}
      </div>
      <div className="shpd-card__body">
        <h4 className="shpd-card__name">{product.name}</h4>
        {product.brandName ? <p className="shpd-card__brand">{product.brandName}</p> : null}
        <p className="shpd-card__cat">{formatCategoryLabel(product.category)}</p>
        <div className="shpd-card__priceRow">
          <p className="shpd-card__price">{formatP(product.price)}</p>
          {product.compareAt ? (
            <p className="shpd-card__compare">{formatP(product.compareAt)}</p>
          ) : null}
        </div>
        {product.inStock ? (
          <button
            type="button"
            className={`shpd-card__add${inCart ? ' shpd-card__add--on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onAdd(product);
            }}
            aria-label={inCart ? `${product.name} added to cart` : `Add ${product.name} to cart`}
          >
            {inCart ? 'Added ✓' : 'Add to cart'}
          </button>
        ) : (
          <span className="shpd-card__add shpd-card__add--off" aria-disabled>
            Unavailable
          </span>
        )}
      </div>
    </article>
  );
}

export default function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { addToCart, totalCount, subtotal, items } = useShopCart();
  const [shop, setShop] = useState(null);
  const [prods, setProds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState(FILTER_ALL);

  const cartProductIds = useMemo(() => new Set(items.map((l) => l.id)), [items]);

  const load = useCallback(async () => {
    if (!shopId) {
      setShop(null);
      setProds([]);
      setLoading(false);
      return;
    }
    setShop(null);
    setProds([]);
    setLoadError('');
    setFilter(FILTER_ALL);
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) {
      setShop(null);
      setProds([]);
      setLoadError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    const DETAIL_PRODUCT_COLUMNS =
      'id, shop_owner_id, name, category, brand_name, description, price, compare_at_price, stock, sku, is_active, offers_free_delivery, image_primary_url, tags';

    const ownerPromise = supabase
      .from('shop_owners')
      .select('id, business_name, business_type, business_address, shop_image_url')
      .eq('id', shopId)
      .maybeSingle();
    const prodPromise = supabase
      .from('shop_products')
      .select(DETAIL_PRODUCT_COLUMNS)
      .eq('shop_owner_id', shopId)
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    const [{ data: ownerRow, error: ownerErr }, prodFirst] = await Promise.all([ownerPromise, prodPromise]);
    if (ownerErr || !ownerRow) {
      setShop(null);
      setProds([]);
      setLoadError(ownerErr?.message || 'Shop not found.');
      setLoading(false);
      return;
    }
    const card = mapShopOwnerToCard(ownerRow);
    setShop(card);
    setLoading(false);

    let { data: productRows, error: prodErr } = prodFirst;
    if (prodErr && /brand_name|offers_free_delivery|column|schema cache/i.test(prodErr.message || '')) {
      ({ data: productRows, error: prodErr } = await supabase
        .from('shop_products')
        .select(
          'id, shop_owner_id, name, category, description, price, compare_at_price, stock, sku, is_active, image_primary_url, tags',
        )
        .eq('shop_owner_id', shopId)
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true }));
    }
    if (prodErr && /tags|column/i.test(prodErr.message || '')) {
      ({ data: productRows, error: prodErr } = await supabase
        .from('shop_products')
        .select(
          'id, shop_owner_id, name, category, description, price, compare_at_price, stock, sku, is_active, image_primary_url',
        )
        .eq('shop_owner_id', shopId)
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true }));
    }
    if (prodErr) {
      setProds([]);
      setLoadError(prodErr.message);
      return;
    }
    setProds(mapRowsToCustomerProducts(productRows, shopId, card.name));
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const p of prods) {
      const label = formatCategoryLabel(p.category);
      if (label) set.add(label);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [prods]);

  const popular = useMemo(() => pickPopularProducts(prods), [prods]);

  const visibleProducts = useMemo(() => {
    if (filter === FILTER_ALL) return prods;
    if (filter === FILTER_POPULAR) return popular;
    return prods.filter((p) => formatCategoryLabel(p.category) === filter);
  }, [filter, prods, popular]);

  const hasCart = totalCount > 0;
  const showPopularShelf = filter === FILTER_ALL && popular.length > 0;

  if (loading) {
    return (
      <div className="shpd-page" role="main">
        <header className="shpd-nav">
          <button type="button" className="shpd-nav__back" onClick={() => navigate('/shops')} aria-label="Back to shops">
            <BackIcon />
          </button>
          <h1 className="shpd-nav__title">Shop</h1>
          <span aria-hidden />
        </header>
        <p className="shpd-status" role="status">
          Loading shop…
        </p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="shpd-page" role="main">
        <header className="shpd-nav">
          <button type="button" className="shpd-nav__back" onClick={() => navigate('/shops')} aria-label="Back to shops">
            <BackIcon />
          </button>
          <h1 className="shpd-nav__title">Shop</h1>
          <span aria-hidden />
        </header>
        {loadError ? (
          <p className="shpd-status shpd-status--err" role="alert">
            {loadError}
          </p>
        ) : (
          <p className="shpd-status">Shop not found.</p>
        )}
        <button type="button" className="shpd-back-link" onClick={() => navigate('/shops')}>
          Back to shops
        </button>
      </div>
    );
  }

  const showNewBadge = shop.rating == null || Number.isNaN(Number(shop.rating));

  return (
    <div className="shpd-page" role="main">
      <header className="shpd-nav">
        <button type="button" className="shpd-nav__back" onClick={() => navigate('/shops')} aria-label="Back to shops">
          <BackIcon />
        </button>
        <h1 className="shpd-nav__title">{shop.name}</h1>
        <div className="shpd-nav__actions">
          <button
            type="button"
            className="shpd-nav__delivery"
            onClick={() => navigate('/request-delivery')}
            aria-label="Request a delivery"
          >
            <DeliveryTruckIcon />
            <span>Delivery</span>
          </button>
          <Link to="/shop/cart" className="shpd-nav__cart" aria-label={`Cart, ${totalCount} items`}>
            <CartIcon />
            <CartBadge count={totalCount} />
          </Link>
        </div>
      </header>

      <section className="shpd-hero" aria-label="Shop information">
        <div className="shpd-hero__inner">
          <div className="shpd-hero__text">
            <h2 className="shpd-hero__name">{shop.name}</h2>
            <div className="shpd-hero__row">
              {showNewBadge ? (
                <span className="shpd-hero__pill">New on InGo</span>
              ) : (
                <span className="shpd-hero__pill shpd-hero__pill--star" aria-label={`Rating ${shop.rating}`}>
                  {stars(Math.floor(Number(shop.rating)))} {shop.rating}
                </span>
              )}
              <span className="shpd-hero__meta">
                {shop.delivery} · {shop.fee}
              </span>
            </div>
            <p className="shpd-hero__count">
              {prods.length} {prods.length === 1 ? 'product' : 'products'}
              {categories.length ? ` · ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}` : ''}
            </p>
          </div>
          <div className="shpd-hero__art" aria-hidden>
            {shop.imageUrl ? (
              <img src={shop.imageUrl} alt="" className="shpd-hero__shopImg" loading="lazy" decoding="async" />
            ) : (
              <StorefrontIcon />
            )}
          </div>
        </div>
      </section>

      {prods.length > 0 ? (
        <nav className="shpd-filters" aria-label="Filter products by category">
          <div className="shpd-filters__track">
            <button
              type="button"
              className={`shpd-chip${filter === FILTER_ALL ? ' shpd-chip--on' : ''}`}
              aria-pressed={filter === FILTER_ALL}
              onClick={() => setFilter(FILTER_ALL)}
            >
              All
            </button>
            <button
              type="button"
              className={`shpd-chip${filter === FILTER_POPULAR ? ' shpd-chip--on' : ''}`}
              aria-pressed={filter === FILTER_POPULAR}
              onClick={() => setFilter(FILTER_POPULAR)}
            >
              Popular
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`shpd-chip${filter === c ? ' shpd-chip--on' : ''}`}
                aria-pressed={filter === c}
                onClick={() => setFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      {loadError ? (
        <p className="shpd-status shpd-status--err" style={{ marginTop: '0.75rem' }} role="alert">
          {loadError}
        </p>
      ) : null}

      <div className={`shpd-scroll${hasCart ? ' shpd-scroll--cart' : ''}`}>
        {prods.length === 0 && !loadError ? (
          <div className="shpd-empty" role="status">
            <EmptyCategoryIcon />
            <p className="shpd-empty__text">This shop has no products yet.</p>
          </div>
        ) : null}

        {showPopularShelf ? (
          <section className="shpd-shelf" aria-label="Popular products">
            <div className="shpd-shelf__head">
              <h3 className="shpd-shelf__title">Popular</h3>
              <button type="button" className="shpd-shelf__more" onClick={() => setFilter(FILTER_POPULAR)}>
                See all
              </button>
            </div>
            <div className="shpd-grid" role="list">
              {popular.map((p) => (
                <ProductCard
                  key={`pop-${p.id}`}
                  product={p}
                  inCart={cartProductIds.has(p.id)}
                  onAdd={addToCart}
                  onOpen={(prod) => navigate(`/shop/${shopId}/product/${prod.id}`)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {prods.length > 0 ? (
          <section
            className="shpd-shelf"
            aria-label={filter === FILTER_POPULAR ? 'Popular products' : filter === FILTER_ALL ? 'All products' : filter}
          >
            <div className="shpd-shelf__head">
              <h3 className="shpd-shelf__title">
                {filter === FILTER_ALL ? 'All products' : filter === FILTER_POPULAR ? 'Popular' : filter}
              </h3>
              <span className="shpd-shelf__count">{visibleProducts.length}</span>
            </div>
            {visibleProducts.length === 0 ? (
              <div className="shpd-empty" role="status">
                <EmptyCategoryIcon />
                <p className="shpd-empty__text">No products in this category yet.</p>
              </div>
            ) : (
              <div className="shpd-grid" role="list">
                {visibleProducts.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    inCart={cartProductIds.has(p.id)}
                    onAdd={addToCart}
                    onOpen={(prod) => navigate(`/shop/${shopId}/product/${prod.id}`)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>

      {hasCart ? (
        <button type="button" className="shpd-cbar" onClick={() => navigate('/shop/cart')}>
          <span className="shpd-cbar__left">
            <CartBarIcon />
            <span className="shpd-cbar__label">
              View Cart — {totalCount} {totalCount === 1 ? 'item' : 'items'}
            </span>
          </span>
          <span className="shpd-cbar__total">{formatP(subtotal)}</span>
        </button>
      ) : null}
    </div>
  );
}
