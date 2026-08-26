import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { mapRowsToCustomerProducts, mapShopOwnerToCard } from '../lib/customerShopMap';
import { readCustomerShopsCache, writeCustomerShopsCache } from '../lib/customerShopsCache';
import { SHOP_BUSINESS_TYPES } from '../lib/shopBusinessTypes';
import { productMatchesSearch } from '../lib/shopProductCategories';
import {
  fetchWeeklyProductStats,
  getPersonalizedRecommendations,
  getTrendingProducts,
  rankPopularThisWeek,
} from '../lib/shopRecommendations';
import { imageFromProductRow, hydrateShelfProductImages, resolveShelfImageUrl, sortProductsWithImagesFirst } from '../lib/shopProductImage';
import { getShopUserBehavior, recordCartAdd, recordShopSearch } from '../lib/shopUserBehavior';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './taxiAndShop.css';
import './shopsPremium.css';

/** Columns only — never pull gallery/variants JSON for the /shops shelves. */
const SHELF_PRODUCT_COLUMNS =
  'id, shop_owner_id, name, category, brand_name, price, compare_at_price, stock, is_active, offers_free_delivery, image_primary_url, tags, created_at';

const SHELF_PRODUCT_COLUMNS_FALLBACK =
  'id, shop_owner_id, name, category, price, compare_at_price, stock, is_active, image_primary_url, tags';

const SHELF_LIMIT = 80;
const SECTION_FOCUS = new Set(['sale', 'free', 'popular', 'picks', 'brand', 'recommendations']);
const POPULAR_GRID_MIN = 4;
const POPULAR_GRID_MAX = 12;

const CATEGORY_CHIP_META = {
  'Hair, beauty & cosmetics': { bg: '#fce7f3', fg: '#db2777', icon: 'beauty' },
  Electronics: { bg: '#dbeafe', fg: '#07408f', icon: 'electronics' },
  Liquor: { bg: '#fef3c7', fg: '#b45309', icon: 'liquor' },
  Pharmacy: { bg: '#ecfdf5', fg: '#059669', icon: 'pharmacy' },
  'Tools & Car parts': { bg: '#ffedd5', fg: '#ea580c', icon: 'tools' },
  'Office and stationery': { bg: '#e0e7ff', fg: '#4338ca', icon: 'office' },
  Restaurants: { bg: '#dcfce7', fg: '#16a34a', icon: 'restaurants' },
  Fashion: { bg: '#fae8ff', fg: '#a21caf', icon: 'fashion' },
  Clothing: { bg: '#ffe4e6', fg: '#e11d48', icon: 'clothing' },
  'Farm Produce': { bg: '#ecfccb', fg: '#4d7c0f', icon: 'farm' },
  'Grocery & Supermarkets': { bg: '#dcfce7', fg: '#15803d', icon: 'grocery' },
  'Restaurants & Takeaways': { bg: '#ffedd5', fg: '#c2410c', icon: 'restaurants' },
  Bakeries: { bg: '#fef3c7', fg: '#a16207', icon: 'bakery' },
  Butcheries: { bg: '#fee2e2', fg: '#b91c1c', icon: 'butcher' },
  Pharmacies: { bg: '#ecfdf5', fg: '#059669', icon: 'pharmacy' },
  'Health & Beauty': { bg: '#fce7f3', fg: '#db2777', icon: 'beauty' },
  'Clothing & Fashion': { bg: '#fae8ff', fg: '#a21caf', icon: 'fashion' },
  'Shoes & Accessories': { bg: '#e0e7ff', fg: '#4338ca', icon: 'shoes' },
  'Phones & Electronics': { bg: '#dbeafe', fg: '#07408f', icon: 'electronics' },
  'Home & Furniture': { bg: '#fef3c7', fg: '#b45309', icon: 'home' },
  'Hardware & Building': { bg: '#ffedd5', fg: '#ea580c', icon: 'tools' },
  'Baby & Kids': { bg: '#fce7f3', fg: '#db2777', icon: 'baby' },
  'Books & Stationery': { bg: '#e0e7ff', fg: '#4338ca', icon: 'office' },
  'Liquor & Beverages': { bg: '#fef3c7', fg: '#b45309', icon: 'liquor' },
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

function IconPharmacy() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <rect x="9" y="7" width="14" height="18" rx="2" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} />
      <path d="M16 11v10M11 16h10" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
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

function IconFashion() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M13 7l3 2 3-2 5 4-3 3v9H11v-9l-3-3 5-4Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClothing() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M12 7l-5 3 2 4 2-1v10h10V13l2 1 2-4-5-3a4 4 0 0 1-8 0Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFarm() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M16 6c-2.5 3.5-4 6.5-4 9a4 4 0 0 0 8 0c0-2.5-1.5-5.5-4-9Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M8 26c1.5-4 4-6 8-6s6.5 2 8 6"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinecap="round"
      />
      <path d="M16 15v5" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function IconGrocery() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M8 10h16l-1.2 12H9.2L8 10Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path
        d="M12 10V9a4 4 0 0 1 8 0v1"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBakery() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M7 20c0-5 4-9 9-9s9 4 9 9v2H7v-2Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path d="M11 14l1.5 3M16 12v3.5M21 14l-1.5 3" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function IconButcher() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M10 8h8l2 6-4 2v8h-4v-8l-4-2 2-6Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path d="M18 10h5l1 4-4 1" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinejoin="round" />
    </svg>
  );
}

function IconShoes() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M6 20c2-4 5-6 10-6h4l6 4v4H6v-2Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path d="M10 20h12" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <path
        d="M6 14L16 6l10 8v12H6V14Z"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinejoin="round"
      />
      <path d="M13 26v-8h6v8" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinejoin="round" />
    </svg>
  );
}

function IconBaby() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden>
      <circle cx="16" cy="12" r="4.5" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} />
      <path
        d="M9 26c1.5-4.5 4-6.5 7-6.5s5.5 2 7 6.5"
        stroke="currentColor"
        strokeWidth={CHIP_ICON_STROKE}
        strokeLinecap="round"
      />
      <path d="M12 8.5c1-1.5 2.5-2 4-2s3 .5 4 2" stroke="currentColor" strokeWidth={CHIP_ICON_STROKE} strokeLinecap="round" />
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
    case 'pharmacy':
      return <span style={{ color }}><IconPharmacy /></span>;
    case 'tools':
      return <span style={{ color }}><IconTools /></span>;
    case 'office':
      return <span style={{ color }}><IconOffice /></span>;
    case 'fashion':
      return <span style={{ color }}><IconFashion /></span>;
    case 'clothing':
      return <span style={{ color }}><IconClothing /></span>;
    case 'farm':
      return <span style={{ color }}><IconFarm /></span>;
    case 'grocery':
      return <span style={{ color }}><IconGrocery /></span>;
    case 'bakery':
      return <span style={{ color }}><IconBakery /></span>;
    case 'butcher':
      return <span style={{ color }}><IconButcher /></span>;
    case 'shoes':
      return <span style={{ color }}><IconShoes /></span>;
    case 'home':
      return <span style={{ color }}><IconHome /></span>;
    case 'baby':
      return <span style={{ color }}><IconBaby /></span>;
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="10.2" cy="10.2" r="4.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M14.3 14.2L19 19" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function formatP(p) {
  return FMT.format(p);
}

function CartBadge({ count }) {
  if (!count) return null;
  return (
    <span className="shp-badge" aria-hidden>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function sanitizeProductImage(item, row) {
  if (!item) return null;
  const imageUrl = resolveShelfImageUrl(item.imageUrl) || imageFromProductRow(row);
  return imageUrl ? { ...item, imageUrl } : { ...item, imageUrl: '' };
}

function idHash(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function createdAtMs(p) {
  const t = p?.createdAt ? Date.parse(p.createdAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function stripInlineShopImage(card) {
  if (!card) return null;
  const url = resolveShelfImageUrl(card.imageUrl);
  if (!url) return { ...card, imageUrl: null };
  return url === card.imageUrl ? card : { ...card, imageUrl: url };
}

async function fetchShopOwnerCards() {
  const rpc = await supabase.rpc('customer_shop_cards');
  if (!rpc.error && Array.isArray(rpc.data)) {
    return (rpc.data || []).map(mapShopOwnerToCard).map(stripInlineShopImage).filter(Boolean);
  }
  const { data, error } = await supabase
    .from('shop_owners')
    .select('id, business_name, business_type, business_address')
    .order('business_name', { ascending: true });
  if (error) throw error;
  const cards = (data || []).map(mapShopOwnerToCard).filter(Boolean);
  return filterShopsWithProducts(cards, null);
}

function filterShopsWithProducts(cards, prodRows) {
  if (!cards?.length) return [];
  if (!prodRows?.length) return cards;
  const shopIds = new Set(prodRows.map((r) => r.shop_owner_id).filter(Boolean));
  return cards.filter((c) => shopIds.has(c.id));
}

async function fetchShelfProductRows() {
  let rows = [];
  const rpc = await supabase.rpc('customer_shop_product_shelf', { lim: SHELF_LIMIT });
  if (!rpc.error && Array.isArray(rpc.data)) {
    rows = rpc.data;
  } else {
    let { data, error } = await supabase
      .from('shop_products')
      .select(SHELF_PRODUCT_COLUMNS)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(SHELF_LIMIT);

    if (error && /brand_name|offers_free_delivery|created_at|column/i.test(error.message || '')) {
      ({ data, error } = await supabase
        .from('shop_products')
        .select(SHELF_PRODUCT_COLUMNS_FALLBACK)
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(SHELF_LIMIT));
    }

    if (error && /tags|column/i.test(error.message || '')) {
      ({ data, error } = await supabase
        .from('shop_products')
        .select(
          'id, shop_owner_id, name, category, price, compare_at_price, stock, is_active, image_primary_url, image_urls',
        )
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(SHELF_LIMIT));
    }

    if (error) return [];
    rows = data || [];
  }

  return hydrateShelfProductImages(supabase, rows);
}

function mergeProductsWithShops(prodRows, cards) {
  if (!prodRows?.length) return [];
  const byShop = Object.fromEntries((cards || []).map((s) => [s.id, s.name]));
  const merged = [];
  for (const row of prodRows) {
    const sid = row.shop_owner_id;
    const list = mapRowsToCustomerProducts([row], sid, byShop[sid] || 'Shop');
    const item = sanitizeProductImage(list[0], row);
    if (item) merged.push(item);
  }
  return merged;
}

export default function CustomerShopsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { totalCount, subtotal, addToCart } = useShopCart();
  const [q, setQ] = useState('');
  const cached = typeof sessionStorage !== 'undefined' ? readCustomerShopsCache() : null;
  const [shops, setShops] = useState(() => cached?.shops || []);
  const [products, setProducts] = useState(() => cached?.products || []);
  const [loading, setLoading] = useState(
    () => !(cached?.shops?.length || cached?.products?.length),
  );
  const [loadError, setLoadError] = useState('');
  const [filterOnSale, setFilterOnSale] = useState(false);
  const [filterFreeDelivery, setFilterFreeDelivery] = useState(false);
  const [filterBrand, setFilterBrand] = useState('');
  const [filterProductCategory, setFilterProductCategory] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [weeklyStats, setWeeklyStats] = useState([]);
  const [saleHeroTab, setSaleHeroTab] = useState('sale');
  const searchTrackRef = useRef(null);

  const showAll = searchParams.get('all') === '1';
  const catParam = searchParams.get('cat');
  const sectionRaw = String(searchParams.get('section') || '').trim().toLowerCase();
  const sectionParam = SECTION_FOCUS.has(sectionRaw) ? sectionRaw : '';

  const selectedCategory = useMemo(() => {
    if (!catParam) return null;
    try {
      const dec = decodeURIComponent(catParam);
      return SHOP_BUSINESS_TYPES.includes(dec) ? dec : null;
    } catch {
      return null;
    }
  }, [catParam]);

  const filtersActive =
    filterOnSale ||
    filterFreeDelivery ||
    Boolean(filterBrand) ||
    Boolean(filterProductCategory) ||
    sortBy !== 'featured';

  const isLanding =
    !showAll && !selectedCategory && !sectionParam && !q.trim() && !filtersActive;

  const showBrowseGrid =
    !isLanding || showAll || Boolean(selectedCategory) || Boolean(sectionParam) || Boolean(q.trim()) || filtersActive;

  useEffect(() => {
    if (!catParam || selectedCategory) return;
    navigate('/shops', { replace: true });
  }, [catParam, selectedCategory, navigate]);

  const loadCatalog = useCallback(async () => {
    setLoadError('');
    if (!isSupabaseConfigured || !supabase) {
      setShops([]);
      setProducts([]);
      setLoadError('Shops load from the database. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    let cards = [];
    let prodRows = [];
    let shopsDone = false;
    let productsDone = false;
    let firstPaint = false;

    const markUseful = () => {
      if (!firstPaint && (shopsDone || productsDone)) {
        firstPaint = true;
        setLoading(false);
      }
    };

    try {
      let shopErr = null;

      const shopsPromise = fetchShopOwnerCards()
        .then((result) => {
          cards = result || [];
          shopsDone = true;
          setShops(cards);
          markUseful();
          return cards;
        })
        .catch((err) => {
          shopErr = err;
          shopsDone = true;
          markUseful();
          return [];
        });

      const productsPromise = fetchShelfProductRows()
        .then((rows) => {
          prodRows = rows || [];
          productsDone = true;
          markUseful();
          return prodRows;
        })
        .catch(() => {
          prodRows = [];
          productsDone = true;
          markUseful();
          return [];
        });

      await Promise.all([shopsPromise, productsPromise]);

      cards = filterShopsWithProducts(cards, prodRows);
      setShops(cards);

      const merged = mergeProductsWithShops(prodRows, cards);
      setProducts(merged);

      if (shopErr && !cards.length) {
        setShops((prev) => {
          if (prev.length) return prev;
          setLoadError(shopErr?.message || 'Could not load stores.');
          return [];
        });
      } else {
        writeCustomerShopsCache(cards, merged);
      }
      setLoading(false);
    } catch (err) {
      setShops((prev) => {
        if (prev.length) return prev;
        setLoadError(err?.message || 'Could not load stores.');
        return [];
      });
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    fetchWeeklyProductStats(supabase).then((stats) => {
      if (!cancelled) setWeeklyStats(stats || []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchTrackRef.current) clearTimeout(searchTrackRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) return undefined;
    searchTrackRef.current = setTimeout(() => recordShopSearch(trimmed), 600);
    return () => {
      if (searchTrackRef.current) clearTimeout(searchTrackRef.current);
    };
  }, [q]);

  const userBehavior = getShopUserBehavior();

  const brands = useMemo(() => {
    const set = new Set();
    for (const p of products) {
      const b = String(p.brandName || '').trim();
      if (b) set.add(b);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const productCategories = useMemo(() => {
    const set = new Set();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products;

    if (selectedCategory) {
      const shopIds = new Set(shops.filter((s) => s.category === selectedCategory).map((s) => s.id));
      list = list.filter((p) => shopIds.has(p.shopId));
    }

    if (q.trim()) {
      list = list.filter((p) => productMatchesSearch(p, q));
    }

    if (filterOnSale || sectionParam === 'sale') {
      list = list.filter((p) => p.onSale);
    }
    if (filterFreeDelivery || sectionParam === 'free') {
      list = list.filter((p) => p.offersFreeDelivery);
    }
    if (filterBrand) {
      list = list.filter((p) => String(p.brandName || '').trim() === filterBrand);
    }
    if (sectionParam === 'brand' && !filterBrand) {
      list = list.filter((p) => Boolean(String(p.brandName || '').trim()));
    }
    if (filterProductCategory) {
      list = list.filter((p) => String(p.category || '').trim() === filterProductCategory);
    }

    const sorted = [...list];
    if (sectionParam === 'recommendations') {
      return getPersonalizedRecommendations(sorted, weeklyStats, userBehavior, sorted.length);
    }
    if (sectionParam === 'popular') {
      return rankPopularThisWeek(sorted, weeklyStats, userBehavior);
    }
    if (sortBy === 'price_asc') {
      sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === 'price_desc') {
      sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else if (sortBy === 'newest') {
      sorted.sort((a, b) => createdAtMs(b) - createdAtMs(a));
    } else if (sectionParam === 'picks') {
      sorted.sort((a, b) => idHash(a.id) - idHash(b.id));
    }

    return sorted;
  }, [
    products,
    shops,
    selectedCategory,
    q,
    filterOnSale,
    filterFreeDelivery,
    filterBrand,
    filterProductCategory,
    sortBy,
    sectionParam,
    weeklyStats,
    userBehavior,
  ]);

  const popularThisWeek = useMemo(() => {
    const ranked = rankPopularThisWeek(filteredProducts, weeklyStats, userBehavior);
    return ranked.slice(0, POPULAR_GRID_MAX);
  }, [filteredProducts, weeklyStats, userBehavior]);

  const recommendations = useMemo(
    () => getPersonalizedRecommendations(filteredProducts, weeklyStats, userBehavior, 12),
    [filteredProducts, weeklyStats, userBehavior],
  );

  const onSale = useMemo(
    () => sortProductsWithImagesFirst(filteredProducts.filter((p) => p.onSale)).slice(0, 12),
    [filteredProducts],
  );

  const trendingProducts = useMemo(
    () => sortProductsWithImagesFirst(getTrendingProducts(filteredProducts, weeklyStats, userBehavior, 12)).slice(0, 8),
    [filteredProducts, weeklyStats, userBehavior],
  );

  const saleHeroItems = useMemo(
    () => (saleHeroTab === 'trending' ? trendingProducts : onSale),
    [saleHeroTab, trendingProducts, onSale],
  );

  const topPicks = useMemo(() => {
    const preferred = filteredProducts.filter((p) => p.inStock && p.imageUrl);
    const pool = preferred.length ? preferred : filteredProducts;
    const byHash = [...pool].sort((a, b) => idHash(a.id) - idHash(b.id));
    if (byHash.length >= 6) return byHash.slice(0, 12);
    // Reuse popular items when catalog is small
    const seen = new Set(byHash.map((p) => p.id));
    const extras = popularThisWeek.filter((p) => !seen.has(p.id));
    return [...byHash, ...extras].slice(0, 12);
  }, [filteredProducts, popularThisWeek]);

  const freeDelivery = useMemo(
    () => filteredProducts.filter((p) => p.offersFreeDelivery).slice(0, 12),
    [filteredProducts],
  );

  const clearFilters = () => {
    setFilterOnSale(false);
    setFilterFreeDelivery(false);
    setFilterBrand('');
    setFilterProductCategory('');
    setSortBy('featured');
  };

  const goCategory = (cat) => {
    navigate(`/shops?cat=${encodeURIComponent(cat)}`);
  };

  const goBrowseAll = () => {
    navigate('/shops?all=1');
  };

  const goCategoriesHome = () => {
    navigate('/shops');
    setQ('');
    clearFilters();
  };

  const onAddProduct = (e, product) => {
    e.stopPropagation();
    e.preventDefault();
    recordCartAdd(product);
    addToCart(product);
  };

  const goProduct = (p) => {
    navigate(`/shop/${p.shopId}/product/${p.id}`);
  };

  const goSection = (section) => {
    if (section === 'home') navigate('/shops');
    else navigate(`/shops?section=${section}`);
  };

  const renderMarketplaceCard = (p, gridMode = false) => (
    <div
      key={p.id}
      className={`shp-mcard${gridMode ? ' shp-mcard--grid' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => goProduct(p)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goProduct(p);
        }
      }}
    >
      <div className="shp-mcard__media">
        {p.imageUrl ? (
          <img className="shp-mcard__img" src={p.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="shp-mcard__ph" aria-hidden />
        )}
        {p.onSale ? <span className="shp-mcard__badge shp-mcard__badge--sale">Sale</span> : null}
        {p.offersFreeDelivery ? (
          <span className="shp-mcard__badge shp-mcard__badge--free">Free delivery</span>
        ) : null}
      </div>
      <div className="shp-mcard__body">
        <p className="shp-mcard__name">{p.name}</p>
        {p.brandName ? <p className="shp-mcard__brand">{p.brandName}</p> : null}
        <div className="shp-mcard__priceRow">
          <span className="shp-mcard__price">{formatP(p.price)}</span>
          {p.onSale && p.compareAt != null ? (
            <span className="shp-mcard__compare">{formatP(p.compareAt)}</span>
          ) : null}
        </div>
        <p className="shp-mcard__shop">{p.shopName}</p>
      </div>
      <button
        type="button"
        className="shp-mcard__add"
        aria-label={`Add ${p.name} to cart`}
        disabled={!p.inStock}
        onClick={(e) => onAddProduct(e, p)}
      >
        +
      </button>
    </div>
  );

  const renderShelfSection = (title, items, viewAllHref) => (
    <section className="shp-section" aria-label={title}>
      <div className="shp-section__head">
        <h2 className="shp-section__title">{title}</h2>
        <button
          type="button"
          className="shp-section__link"
          onClick={() => (viewAllHref ? navigate(viewAllHref) : goBrowseAll())}
        >
          View all
        </button>
      </div>
      {items.length === 0 ? (
        <p className="shp-msg shp-msg--muted">Products will appear when shops add items.</p>
      ) : (
        <div className="shp-hscroll">{items.map((p) => renderMarketplaceCard(p))}</div>
      )}
    </section>
  );

  const renderPopularGridSection = () => (
    <section className="shp-section shp-section--popular" aria-label="Popular items this week">
      <div className="shp-section__head">
        <h2 className="shp-section__title">Popular items this week</h2>
        <button type="button" className="shp-section__link" onClick={() => goSection('popular')}>
          View all
        </button>
      </div>
      {popularThisWeek.length === 0 ? (
        <p className="shp-msg shp-msg--muted">Products will appear when shops add items.</p>
      ) : (
        <div className="shp-popular-grid">
          {popularThisWeek.slice(0, Math.max(POPULAR_GRID_MIN, POPULAR_GRID_MAX)).map((p) =>
            renderMarketplaceCard(p, true),
          )}
        </div>
      )}
    </section>
  );

  const renderRecommendationsSection = () => (
    <section className="shp-section shp-section--recs" id="shop-recommendations" aria-label="Recommendations">
      <div className="shp-section__head">
        <h2 className="shp-section__title">Recommendations</h2>
        <button type="button" className="shp-section__link" onClick={() => goSection('recommendations')}>
          View all
        </button>
      </div>
      {recommendations.length === 0 ? (
        <p className="shp-msg shp-msg--muted">Browse products to get personalized picks.</p>
      ) : (
        <div className="shp-popular-grid">
          {recommendations.slice(0, 8).map((p) => renderMarketplaceCard(p, true))}
        </div>
      )}
    </section>
  );

  const renderSaleHero = () => (
    <section className="shp-sale-hero" aria-label="Products on sale">
      <div className="shp-sale-hero__head">
        <div>
          <p className="shp-sale-hero__eyebrow">Limited time deals</p>
          <h2 className="shp-sale-hero__title">Products on sale</h2>
        </div>
        <div className="shp-sale-hero__tabs" role="tablist" aria-label="Sale module">
          <button
            type="button"
            role="tab"
            aria-selected={saleHeroTab === 'sale'}
            className={`shp-sale-hero__tab${saleHeroTab === 'sale' ? ' shp-sale-hero__tab--on' : ''}`}
            onClick={() => setSaleHeroTab('sale')}
          >
            On sale
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={saleHeroTab === 'trending'}
            className={`shp-sale-hero__tab${saleHeroTab === 'trending' ? ' shp-sale-hero__tab--on' : ''}`}
            onClick={() => setSaleHeroTab('trending')}
          >
            Trending products
          </button>
        </div>
      </div>
      {saleHeroItems.length === 0 ? (
        <p className="shp-sale-hero__empty">No {saleHeroTab === 'trending' ? 'trending' : 'sale'} items right now.</p>
      ) : (
        <div className="shp-sale-hero__scroll">
          {saleHeroItems.slice(0, 6).map((p) => renderMarketplaceCard(p))}
        </div>
      )}
      <button type="button" className="shp-sale-hero__cta" onClick={() => goSection('sale')}>
        Check It Out
      </button>
    </section>
  );

  const renderHomeNav = () => (
    <nav className="shp-home-nav" aria-label="Shop homepage">
      <button
        type="button"
        className={`shp-home-nav__btn${sectionParam === 'recommendations' ? ' shp-home-nav__btn--on' : ''}`}
        onClick={() => goSection('recommendations')}
      >
        Recommendations
      </button>
      <button
        type="button"
        className={`shp-home-nav__btn${sectionParam === 'popular' ? ' shp-home-nav__btn--on' : ''}`}
        onClick={() => goSection('popular')}
      >
        Popular
      </button>
      <button
        type="button"
        className={`shp-home-nav__btn${sectionParam === 'sale' ? ' shp-home-nav__btn--on' : ''}`}
        onClick={() => goSection('sale')}
      >
        Sale
      </button>
      <button
        type="button"
        className={`shp-home-nav__btn${sectionParam === 'free' ? ' shp-home-nav__btn--on' : ''}`}
        onClick={() => goSection('free')}
      >
        Free delivery
      </button>
    </nav>
  );

  const browseTitle = (() => {
    if (sectionParam === 'sale') return 'Products on sale';
    if (sectionParam === 'free') return 'Free delivery';
    if (sectionParam === 'popular') return 'Popular this week';
    if (sectionParam === 'recommendations') return 'Recommendations';
    if (sectionParam === 'picks') return 'Top picks';
    if (sectionParam === 'brand') return filterBrand || 'Shop by brand';
    if (selectedCategory) return selectedCategory;
    if (showAll || q.trim() || filtersActive) return 'All products';
    return 'All products';
  })();

  return (
    <div className="shp-page">
      <header className="shp-nav">
        <span aria-hidden />
        <h1 className="shp-nav__title">Shop</h1>
        <div className="shp-nav__actions">
          <button
            type="button"
            className="shp-nav__delivery"
            onClick={() => navigate('/request-delivery')}
            aria-label="Request a delivery"
          >
            <DeliveryTruckIcon />
            <span>Delivery</span>
          </button>
          <Link to="/shop/cart" className="shp-nav__cart" aria-label={`Cart, ${totalCount} items`}>
            <CartIcon />
            <CartBadge count={totalCount} />
          </Link>
        </div>
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
            placeholder="Search products, brands, or shops"
            aria-label="Search products, brands, or shops"
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

        {isLanding && !loading ? (
          <>
            {renderSaleHero()}
            {renderHomeNav()}
          </>
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

        <div className="shp-filterbar">
          <button
            type="button"
            className={`shp-filterbar__btn${filtersOpen || filtersActive ? ' shp-filterbar__btn--on' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            Filters{filtersActive ? ' · on' : ''}
          </button>
          <button type="button" className="shp-filterbar__link" onClick={goBrowseAll}>
            Browse all
          </button>
        </div>

        {filtersOpen ? (
          <div className="shp-filters" role="region" aria-label="Product filters">
            <label className="shp-filters__check">
              <input
                type="checkbox"
                checked={filterOnSale}
                onChange={(e) => setFilterOnSale(e.target.checked)}
              />
              On sale
            </label>
            <label className="shp-filters__check">
              <input
                type="checkbox"
                checked={filterFreeDelivery}
                onChange={(e) => setFilterFreeDelivery(e.target.checked)}
              />
              Free delivery
            </label>
            <label className="shp-filters__field">
              <span>Brand</span>
              <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="shp-filters__field">
              <span>Product category</span>
              <select
                value={filterProductCategory}
                onChange={(e) => setFilterProductCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {productCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="shp-filters__field">
              <span>Sort</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="featured">Featured</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="newest">Newest</option>
              </select>
            </label>
            <button type="button" className="shp-filters__clear" onClick={clearFilters}>
              Clear
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="shp-skel" aria-busy="true" aria-label="Loading marketplace">
            <div className="shp-skel__row" />
            <div className="shp-skel__grid">
              <div className="shp-skel__card" />
              <div className="shp-skel__card" />
              <div className="shp-skel__card" />
              <div className="shp-skel__card" />
            </div>
          </div>
        ) : null}

        {showBrowseGrid ? (
          <section className="shp-section" aria-label={browseTitle}>
            <div className="shp-section__head">
              <h2 className="shp-section__title">{browseTitle}</h2>
              <span className="shp-section__count">{filteredProducts.length}</span>
            </div>
            {filteredProducts.length === 0 ? (
              <p className="shp-msg shp-msg--muted" role="status">
                {products.length === 0
                  ? 'No products yet.'
                  : 'No products match your filters.'}
              </p>
            ) : (
              <div className="shp-mgrid">{filteredProducts.map((p) => renderMarketplaceCard(p))}</div>
            )}
          </section>
        ) : (
          <>
            {renderPopularGridSection()}
            {renderRecommendationsSection()}
            {renderShelfSection('This week’s top picks', topPicks, '/shops?section=picks')}
            {renderShelfSection('Products with free delivery', freeDelivery, '/shops?section=free')}
          </>
        )}
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
