import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { mapRowsToCustomerProducts, mapShopOwnerToCard } from '../lib/customerShopMap';
import { SHOP_BUSINESS_TYPES } from '../lib/shopBusinessTypes';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './taxiAndShop.css';
import './shopsPremium.css';

const STORE_LOGO_COLORS = ['#16a34a', '#dc2626', '#07408f', '#ec6c23', '#7c3aed'];
const RESTAURANT_CATEGORY = 'Restaurants';

const CATEGORY_CHIP_META = {
  'Hair, beauty & cosmetics': { bg: '#fce7f3', fg: '#db2777', icon: 'beauty' },
  Electronics: { bg: '#dbeafe', fg: '#07408f', icon: 'electronics' },
  Liquor: { bg: '#fef3c7', fg: '#b45309', icon: 'liquor' },
  'Tools & Car parts': { bg: '#ffedd5', fg: '#ea580c', icon: 'tools' },
  'Office and stationery': { bg: '#e0e7ff', fg: '#4338ca', icon: 'office' },
  Restaurants: { bg: '#dcfce7', fg: '#16a34a', icon: 'restaurants' },
};

function chipMeta(cat) {
  return CATEGORY_CHIP_META[cat] || { bg: '#f3f4f6', fg: '#6b7280', icon: 'default' };
}

const CHIP_ICON_STROKE = 1.5;

function IconBeauty() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <circle cx="16" cy="11" r="4.5" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} />
      <path
        d="M9 25c1.8-4.2 4.2-6 7-6s5.2 1.8 7 6"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconElectronics() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <rect x="7" y="9" width="18" height="12" rx="2" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} />
      <path d="M13 25h6" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function IconLiquor() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M11 8h10l-4 12v3h-2v-3L11 8Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path d="M14 23v3" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
      <path d="M11 26h10" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function IconTools() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M18.5 6L12 17.5h5.5l-3.5 10.5L22 14h-6l2.5-8Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconOffice() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M11 8h10l3 3v15H11V8Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path d="M21 8v3h3" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinejoin="round" />
      <path d="M14 15h8M14 19h6M14 23h8" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function IconRestaurants() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M10 12h12l-1.4 11.5H11.4L10 12Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M13 12V10a3 3 0 0 1 6 0v2"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

function CategoryChipIcon({ icon, color }) {
  switch (icon) {
    case 'beauty':
      return <span style={{ color }}><IconBeauty /></span>;
    case 'electronics':
      return <span style={{ color }}><IconElectronics /></span>;
    case 'liquor':
      return <span style={{ color }}><IconLiquor /></span>;
    case 'tools':
      return <span style={{ color }}><IconTools /></span>;
    case 'office':
      return <span style={{ color }}><IconOffice /></span>;
    case 'restaurants':
    default:
      return <span style={{ color }}><IconRestaurants /></span>;
  }
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="10.2" cy="10.2" r="4.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M14.3 14.2L19 19" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function stars(n) {
  return '★'.repeat(Math.max(0, Math.min(5, Math.floor(n) || 0)));
}

function formatP(p) {
  return FMT.format(p);
}

function storeDisplayRating(rating) {
  if (rating == null || Number.isNaN(Number(rating))) return 4.5;
  return Number(rating);
}

function storeDeliveryLabel(delivery) {
  const d = String(delivery || '').trim();
  if (/min/i.test(d)) return d;
  return '20–30 min';
}

function CartBadge({ count }) {
  if (!count) return null;
  return (
    <span className="shp-badge" aria-hidden>
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function CustomerShopsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { totalCount, subtotal, addToCart } = useShopCart();
  const [q, setQ] = useState('');
  const [shops, setShops] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const showAll = searchParams.get('all') === '1';
  const catParam = searchParams.get('cat');

  const selectedCategory = useMemo(() => {
    if (!catParam) return null;
    try {
      const dec = decodeURIComponent(catParam);
      return SHOP_BUSINESS_TYPES.includes(dec) ? dec : null;
    } catch {
      return null;
    }
  }, [catParam]);

  const isLanding = !showAll && selectedCategory === null;

  useEffect(() => {
    if (!catParam || selectedCategory) return;
    navigate('/shops', { replace: true });
  }, [catParam, selectedCategory, navigate]);

  const loadShops = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) {
      setShops([]);
      setProducts([]);
      setLoadError('Shops load from the database. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('shop_owners')
      .select('id, business_name, business_type, business_address, shop_image_url')
      .order('business_name', { ascending: true });
    if (error) {
      setShops([]);
      setProducts([]);
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    const cards = (data || []).map(mapShopOwnerToCard).filter(Boolean);
    setShops(cards);

    const { data: prodRows, error: prodErr } = await supabase
      .from('shop_products')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(32);
    if (!prodErr && prodRows?.length) {
      const byShop = Object.fromEntries(cards.map((s) => [s.id, s.name]));
      const merged = [];
      for (const row of prodRows) {
        const sid = row.shop_owner_id;
        const list = mapRowsToCustomerProducts([row], sid, byShop[sid] || 'Shop');
        if (list[0]) merged.push(list[0]);
      }
      setProducts(merged);
    } else {
      setProducts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  const filteredShops = useMemo(() => {
    let list = shops;
    if (selectedCategory) {
      list = list.filter((s) => s.category === selectedCategory);
    }
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((s) => `${s.name} ${s.category} ${s.delivery}`.toLowerCase().includes(t));
  }, [q, shops, selectedCategory]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (selectedCategory) {
      const shopIds = new Set(shops.filter((s) => s.category === selectedCategory).map((s) => s.id));
      list = list.filter((p) => shopIds.has(p.shopId));
    }
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((p) => `${p.name} ${p.shopName} ${p.category}`.toLowerCase().includes(t));
  }, [q, products, shops, selectedCategory]);

  const bestSelling = useMemo(() => filteredProducts.slice(0, 8), [filteredProducts]);
  const recommended = useMemo(() => filteredProducts.slice(8, 16), [filteredProducts]);

  const popularRestaurants = useMemo(() => {
    let list = shops.filter((s) => {
      const c = String(s.category || '').trim().toLowerCase();
      return c === RESTAURANT_CATEGORY.toLowerCase() || c === 'restaurant';
    });
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((s) => `${s.name} ${s.category} ${s.delivery}`.toLowerCase().includes(t));
  }, [q, shops]);

  const storesTitle = showAll ? 'All stores' : selectedCategory || 'Popular Stores';
  const showPopularRestaurants = isLanding;

  const goCategory = (cat) => {
    navigate(`/shops?cat=${encodeURIComponent(cat)}`);
  };

  const goBrowseAll = () => {
    navigate('/shops?all=1');
  };

  const goCategoriesHome = () => {
    navigate('/shops');
    setQ('');
  };

  const onAddProduct = (e, product) => {
    e.stopPropagation();
    e.preventDefault();
    addToCart(product);
  };

  const renderStoreCard = (s, i) => {
    const color = STORE_LOGO_COLORS[i % STORE_LOGO_COLORS.length];
    const initial = (s.name || 'S').trim().charAt(0).toUpperCase();
    const rating = storeDisplayRating(s.rating);
    return (
      <button
        key={s.id}
        type="button"
        className="shp-store"
        onClick={() => navigate(`/shop/${s.id}`)}
      >
        <div className="shp-store__logo" style={{ background: s.imageUrl ? '#f3f4f6' : color }}>
          {s.imageUrl ? (
            <img src={s.imageUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            initial
          )}
        </div>
        <p className="shp-store__name">{s.name}</p>
        <p className="shp-store__time">{storeDeliveryLabel(s.delivery)}</p>
        <p className="shp-store__stars" aria-label={`Rating ${rating} out of 5`}>
          <span aria-hidden>{stars(Math.round(rating))}</span> {rating.toFixed(1)}
        </p>
      </button>
    );
  };

  const renderProductCard = (p) => (
    <div
      key={p.id}
      className="shp-product"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/shop/${p.shopId}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/shop/${p.shopId}`);
        }
      }}
    >
      {p.imageUrl ? (
        <img className="shp-product__img" src={p.imageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="shp-product__ph" aria-hidden>
          🛒
        </div>
      )}
      <div className="shp-product__body">
        <p className="shp-product__name">{p.name}</p>
        <p className="shp-product__price">{formatP(p.price)}</p>
      </div>
      <button
        type="button"
        className="shp-product__add"
        aria-label={`Add ${p.name} to cart`}
        disabled={!p.inStock}
        onClick={(e) => onAddProduct(e, p)}
      >
        +
      </button>
    </div>
  );

  return (
    <div className="shp-page">
      <header className="shp-nav">
        <span aria-hidden />
        <h1 className="shp-nav__title">Shop</h1>
        <Link to="/shop/cart" className="shp-nav__cart" aria-label={`Cart, ${totalCount} items`}>
          <CartIcon />
          <CartBadge count={totalCount} />
        </Link>
      </header>

      <div className="shp-hero">
        <div className="shp-search" role="search">
          <span className="shp-search__icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="shp-search__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for products or stores"
            aria-label="Search for products or stores"
          />
          <Link to="/shop/cart" className="shp-search__cart" aria-label={`Cart, ${totalCount} items`}>
            <CartIcon />
            <CartBadge count={totalCount} />
          </Link>
        </div>
      </div>

      <div className="shp-scroll">
        {!isLanding ? (
          <button type="button" className="shp-back" onClick={goCategoriesHome}>
            ← Categories
          </button>
        ) : null}

        {loadError ? (
          <p className="shp-msg shp-msg--err" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="shp-panel">
          <div className="shp-cats" role="navigation" aria-label="Shop categories">
            {SHOP_BUSINESS_TYPES.map((cat) => {
              const meta = chipMeta(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  className={`shp-cat${selectedCategory === cat ? ' shp-cat--on' : ''}`}
                  onClick={() => goCategory(cat)}
                  aria-label={cat}
                >
                  <span className="shp-cat__icon" style={{ background: meta.bg }}>
                    <CategoryChipIcon icon={meta.icon} color={meta.fg} />
                  </span>
                  <span className="shp-cat__label">{cat}</span>
                </button>
              );
            })}
          </div>
        </div>

        <section className="shp-section" aria-label={storesTitle}>
          <div className="shp-section__head">
            <h2 className="shp-section__title">{storesTitle}</h2>
            <button type="button" className="shp-section__link" onClick={goBrowseAll}>
              View all
            </button>
          </div>
          {loading ? (
            <p className="shp-msg shp-msg--muted">Loading stores…</p>
          ) : filteredShops.length === 0 ? (
            <p className="shp-msg shp-msg--muted" role="status">
              {shops.length === 0
                ? 'No registered shops yet.'
                : q.trim()
                  ? 'No stores match your search.'
                  : 'No stores in this category yet.'}
            </p>
          ) : (
            <div className="shp-hscroll">{filteredShops.map((s, i) => renderStoreCard(s, i))}</div>
          )}
        </section>

        {showPopularRestaurants ? (
          <section className="shp-section" aria-label="Popular Restaurants">
            <div className="shp-section__head">
              <h2 className="shp-section__title">Popular Restaurants</h2>
              <button
                type="button"
                className="shp-section__link"
                onClick={() => goCategory(RESTAURANT_CATEGORY)}
              >
                View all
              </button>
            </div>
            {loading ? (
              <p className="shp-msg shp-msg--muted">Loading restaurants…</p>
            ) : popularRestaurants.length === 0 ? (
              <p className="shp-msg shp-msg--muted" role="status">
                {shops.length === 0
                  ? 'No registered shops yet.'
                  : q.trim()
                    ? 'No restaurants match your search.'
                    : 'No restaurants listed yet. Restaurant shops will appear here when they register.'}
              </p>
            ) : (
              <div className="shp-hscroll">
                {popularRestaurants.map((s, i) => renderStoreCard(s, i))}
              </div>
            )}
          </section>
        ) : null}

        {isLanding ? (
          <>
            <section className="shp-section" aria-label="Best selling">
              <div className="shp-section__head">
                <h2 className="shp-section__title">Best Selling</h2>
                <button type="button" className="shp-section__link" onClick={goBrowseAll}>
                  View all
                </button>
              </div>
              {bestSelling.length === 0 ? (
                <p className="shp-msg shp-msg--muted">Products will appear when shops add items.</p>
              ) : (
                <div className="shp-hscroll">{bestSelling.map((p) => renderProductCard(p))}</div>
              )}
            </section>

            <div className="shp-promo" aria-label="Promotion">
              <div>
                <p className="shp-promo__title">Free Delivery</p>
                <p className="shp-promo__sub">On orders over $25</p>
              </div>
              <span className="shp-promo__art" aria-hidden>
                🛍️
              </span>
            </div>

            <section className="shp-section" aria-label="Recommended for you">
              <div className="shp-section__head">
                <h2 className="shp-section__title">Recommended for you</h2>
                <button type="button" className="shp-section__link" onClick={goBrowseAll}>
                  View all
                </button>
              </div>
              {recommended.length === 0 ? (
                <p className="shp-msg shp-msg--muted">More picks coming soon.</p>
              ) : (
                <div className="shp-hscroll">{recommended.map((p) => renderProductCard(p))}</div>
              )}
            </section>
          </>
        ) : null}
      </div>

      {totalCount > 0 && (
        <Link
          to="/shop/cart"
          className="shop__cbar"
          tabIndex={0}
          aria-label={`View cart, ${totalCount} items, total ${formatP(subtotal)}`}
        >
          <span className="shop__cbarL">
            View Cart — {totalCount} {totalCount === 1 ? 'item' : 'items'}
          </span>
          <span className="shop__cbarR" aria-hidden>
            {formatP(subtotal)}
          </span>
        </Link>
      )}
    </div>
  );
}
