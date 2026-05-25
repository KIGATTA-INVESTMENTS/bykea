import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { mapRowsToCustomerProducts, mapShopOwnerToCard } from '../lib/customerShopMap';
import { groupByCategory } from '../data/mockShopData';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './shopDetailPremium.css';

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
      <path
        d="M8 32h64"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="40" cy="22" r="6" fill="#EC6C23" opacity="0.9" />
    </svg>
  );
}

function ImagePlaceholderIcon() {
  return (
    <svg className="shpd-card__ph-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden>
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

export default function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { addToCart, totalCount, subtotal, items } = useShopCart();
  const [shop, setShop] = useState(null);
  const [prods, setProds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

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
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) {
      setShop(null);
      setProds([]);
      setLoadError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    const { data: ownerRow, error: ownerErr } = await supabase
      .from('shop_owners')
      .select('id, business_name, business_type, business_address, shop_image_url')
      .eq('id', shopId)
      .maybeSingle();
    if (ownerErr || !ownerRow) {
      setShop(null);
      setProds([]);
      setLoadError(ownerErr?.message || 'Shop not found.');
      setLoading(false);
      return;
    }
    const card = mapShopOwnerToCard(ownerRow);
    setShop(card);
    const { data: productRows, error: prodErr } = await supabase
      .from('shop_products')
      .select('*')
      .eq('shop_owner_id', shopId)
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    setLoading(false);
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

  const byCat = groupByCategory(prods);
  const hasCart = totalCount > 0;

  if (loading) {
    return (
      <div className="shpd-page" role="main">
        <header className="shpd-nav">
          <button
            type="button"
            className="shpd-nav__back"
            onClick={() => navigate('/shops')}
            aria-label="Back to shops"
          >
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
          <button
            type="button"
            className="shpd-nav__back"
            onClick={() => navigate('/shops')}
            aria-label="Back to shops"
          >
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
        <button
          type="button"
          className="shpd-nav__back"
          onClick={() => navigate('/shops')}
          aria-label="Back to shops"
        >
          <BackIcon />
        </button>
        <h1 className="shpd-nav__title">{shop.name}</h1>
        <Link to="/shop/cart" className="shpd-nav__cart" aria-label={`Cart, ${totalCount} items`}>
          <CartIcon />
          <CartBadge count={totalCount} />
        </Link>
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
          </div>
          <div className="shpd-hero__art" aria-hidden>
            <StorefrontIcon />
          </div>
        </div>
      </section>

      {loadError ? (
        <p className="shpd-status shpd-status--err" style={{ marginTop: '0.75rem' }} role="alert">
          {loadError}
        </p>
      ) : null}

      <div className={`shpd-scroll${hasCart ? ' shpd-scroll--cart' : ''}`}>
        {prods.length === 0 && !loadError ? (
          <div className="shpd-empty" role="status">
            <EmptyCategoryIcon />
            <p className="shpd-empty__text">No products in this category yet.</p>
          </div>
        ) : null}

        {byCat.map(([cname, products]) => (
          <section key={cname} className="shpd-cat">
            <div className="shpd-cat__head">
              <h3 className="shpd-cat__label">{cname}</h3>
              <span className="shpd-cat__line" aria-hidden />
            </div>
            {products.length === 0 ? (
              <div className="shpd-empty" role="status">
                <EmptyCategoryIcon />
                <p className="shpd-empty__text">No products in this category yet.</p>
              </div>
            ) : (
              <div className="shpd-products" role="list">
                {products.map((p) => {
                  const inCart = cartProductIds.has(p.id);
                  return (
                    <article key={p.id} className="shpd-card" role="listitem">
                      <div className="shpd-card__thumb">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" />
                        ) : (
                          <ImagePlaceholderIcon />
                        )}
                      </div>
                      <div className="shpd-card__body">
                        <h4 className="shpd-card__name">{p.name}</h4>
                        <p className="shpd-card__price">{formatP(p.price)}</p>
                        <span className="shpd-card__tag">{formatCategoryLabel(p.category)}</span>
                      </div>
                      {p.inStock ? (
                        <button
                          type="button"
                          className={`shpd-card__add${inCart ? ' shpd-card__add--on' : ''}`}
                          onClick={() => addToCart(p)}
                          aria-label={inCart ? `${p.name} added to cart` : `Add ${p.name} to cart`}
                        >
                          {inCart ? 'Added ✓' : 'Add to cart'}
                        </button>
                      ) : (
                        <span className="shpd-card__add shpd-card__add--off" aria-disabled>
                          Unavailable
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ))}
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
