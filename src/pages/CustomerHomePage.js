import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import InGoLogo from '../components/InGoLogo';
import '../components/customer/CustomerApp.css';
import { mapRowsToCustomerProducts, mapShopOwnerToCard } from '../lib/customerShopMap';
import { readCustomerShopsCache } from '../lib/customerShopsCache';
import { FMT_GBP as FMT } from '../lib/currency';
import { getPersonalizedRecommendations, fetchWeeklyProductStats } from '../lib/shopRecommendations';
import { hydrateShelfProductImages, imageFromProductRow, resolveShelfImageUrl } from '../lib/shopProductImage';
import { getShopUserBehavior } from '../lib/shopUserBehavior';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

import { getCustomerSession } from '../lib/customerSession';

function greetingFirstName(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const full = String(profile.full_name || '').trim();
  if (full) {
    const first = full.split(/\s+/)[0];
    return first || full;
  }
  const email = String(profile.email || '').trim();
  if (email && email.includes('@')) {
    return email.split('@')[0] || '';
  }
  return '';
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M12 3a4.5 4.5 0 0 0-4.5 4.5V10l-1.2 2.4A1 1 0 0 1 7.2 14h9.6a1 1 0 0 1 .9-1.6L17 10V7.5A4.5 4.5 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M10.5 18a1.5 1.5 0 0 0 3 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function IconDeliverBag() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden>
      <rect x="5" y="8" width="14" height="12" rx="2" fill="#EC6C23" fillOpacity="0.15" stroke="#EC6C23" strokeWidth="1.6" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" stroke="#EC6C23" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconShopBag() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden>
      <path
        d="M6 7h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Z"
        stroke="#16a34a"
        strokeWidth="1.6"
        fill="#16a34a"
        fillOpacity="0.12"
      />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#16a34a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PromoBannerIcon() {
  return (
    <svg className="ch-promo-banner__illus" viewBox="0 0 72 72" fill="none" aria-hidden>
      <circle cx="36" cy="36" r="32" fill="#07408F" fillOpacity="0.1" />
      <circle cx="36" cy="36" r="32" stroke="#07408F" strokeOpacity="0.12" strokeWidth="1.5" />
      <rect x="16" y="22" width="16" height="13" rx="2.5" fill="#EC6C23" />
      <path d="M17.5 26h13M17.5 30.5h9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.85" />
      <rect x="14" y="34" width="26" height="16" rx="3" fill="#07408F" fillOpacity="0.14" stroke="#07408F" strokeWidth="1.7" />
      <path
        d="M40 34h8l7 9v7H40V34Z"
        fill="#07408F"
        fillOpacity="0.14"
        stroke="#07408F"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M47 34v-5a2.5 2.5 0 0 1 5 0v5" stroke="#07408F" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="22" cy="52" r="5" fill="#fff" stroke="#07408F" strokeWidth="1.7" />
      <circle cx="22" cy="52" r="2" fill="#07408F" fillOpacity="0.35" />
      <circle cx="48" cy="52" r="5" fill="#fff" stroke="#07408F" strokeWidth="1.7" />
      <circle cx="48" cy="52" r="2" fill="#07408F" fillOpacity="0.35" />
      <path d="M54 38h6l3 5" stroke="#EC6C23" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 38h3M60 41h3" stroke="#EC6C23" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.7" />
    </svg>
  );
}

const services = [
  { id: 'delivery', label: 'Deliver', subtitle: 'Fast deliveries', Icon: IconDeliverBag, iconClass: 'ch-svc-card__icon ch-svc-card__icon--orange' },
  { id: 'shop', label: 'Shop', subtitle: 'Shop online', Icon: IconShopBag, iconClass: 'ch-svc-card__icon ch-svc-card__icon--green' },
];

const RECOMMEND_LIMIT = 4;

function formatP(p) {
  return FMT.format(p);
}

async function loadRecommendationsCatalog() {
  const cached = readCustomerShopsCache();
  if (cached?.products?.length && cached.products.every((p) => p.imageUrl)) {
    return cached.products;
  }

  if (!isSupabaseConfigured || !supabase) return [];

  const rpc = await supabase.rpc('customer_shop_product_shelf', { lim: 48 });
  if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length) {
    const rows = await hydrateShelfProductImages(supabase, rpc.data);
    const shopIds = [...new Set(rows.map((r) => r.shop_owner_id).filter(Boolean))];
    let nameById = {};
    if (shopIds.length) {
      const { data: shops } = await supabase
        .from('shop_owners')
        .select('id, business_name')
        .in('id', shopIds);
      nameById = Object.fromEntries((shops || []).map((s) => [s.id, mapShopOwnerToCard(s)?.name || 'Shop']));
    }
    const merged = [];
    for (const row of rows) {
      const sid = row.shop_owner_id;
      const item = mapRowsToCustomerProducts([row], sid, nameById[sid] || 'Shop')[0];
      if (!item) continue;
      const imageUrl = resolveShelfImageUrl(item.imageUrl) || imageFromProductRow(row);
      merged.push(imageUrl ? { ...item, imageUrl } : item);
    }
    return merged;
  }
  return cached?.products || [];
}

function RecProductCard({ product, onOpen }) {
  return (
    <button type="button" className="ch-rec-card" onClick={() => onOpen(product)}>
      <div className="ch-rec-card__media">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="ch-rec-card__ph" aria-hidden />
        )}
      </div>
      <p className="ch-rec-card__name">{product.name}</p>
      <p className="ch-rec-card__price">{formatP(product.price)}</p>
      <p className="ch-rec-card__shop">{product.shopName}</p>
    </button>
  );
}

export default function CustomerHomePage() {
  const navigate = useNavigate();
  const displayName = useMemo(() => greetingFirstName(getCustomerSession()), []);
  const [activeService, setActiveService] = useState('delivery');
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [weeklyStats, setWeeklyStats] = useState([]);
  const [recsLoading, setRecsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRecsLoading(true);
      const [products, stats] = await Promise.all([
        loadRecommendationsCatalog(),
        isSupabaseConfigured && supabase ? fetchWeeklyProductStats(supabase) : Promise.resolve([]),
      ]);
      if (!cancelled) {
        setCatalogProducts(products || []);
        setWeeklyStats(stats || []);
        setRecsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const recommendations = useMemo(() => {
    const behavior = getShopUserBehavior();
    return getPersonalizedRecommendations(catalogProducts, weeklyStats, behavior, RECOMMEND_LIMIT);
  }, [catalogProducts, weeklyStats]);

  const onServiceClick = (service) => {
    setActiveService(service.id);
    if (service.id === 'delivery') navigate('/request-delivery');
    if (service.id === 'shop') navigate('/shops');
  };

  const openProduct = (p) => {
    navigate(`/shop/${p.shopId}/product/${p.id}`);
  };

  return (
    <div className="ch-home ch-home--premium" role="main" aria-label="InGo home">
      <header className="ch-premium-header">
        <div className="ch-premium-nav">
          <button
            type="button"
            className="ch-premium-nav__btn"
            aria-label="Menu"
            onClick={() => navigate('/profile')}
          >
            <IconMenu />
          </button>
          <div className="ch-premium-nav__center">
            <InGoLogo variant="nav" />
            <p className="ch-premium-nav__tagline">Deliver. Ride. Shop.</p>
          </div>
          <button
            type="button"
            className="ch-premium-nav__btn"
            aria-label="Notifications"
            onClick={() => navigate('/notifications')}
          >
            <BellIcon />
          </button>
        </div>

        <div className="ch-premium-greet">
          <h1 className="ch-premium-greet__title">{displayName ? `Hi, ${displayName} 👋` : 'Hi there 👋'}</h1>
          <p className="ch-premium-greet__sub">What would you like to do today?</p>
        </div>
      </header>

      <div className="ch-premium-scroll">
        <section className="ch-svc-cards" aria-label="Services">
          <div className="ch-svc-cards__row">
            {services.map((service) => {
              const { id, label, subtitle, Icon, iconClass } = service;
              return (
                <button
                  key={id}
                  type="button"
                  className={`ch-svc-card${activeService === id ? ' ch-svc-card--active' : ''}`}
                  aria-label={label}
                  onClick={() => onServiceClick(service)}
                >
                  <span className={iconClass}>
                    <Icon />
                  </span>
                  <span className="ch-svc-card__label">{label}</span>
                  <span className="ch-svc-card__sub">{subtitle}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="ch-promo-banner" aria-label="About InGo">
          <div className="ch-promo-banner__text">
            <p className="ch-promo-banner__off">Your local delivery partner</p>
            <p className="ch-promo-banner__line">Send parcels, book rides, and shop from stores near you — all in one app.</p>
          </div>
          <PromoBannerIcon />
        </section>

        <section className="ch-recent" aria-label="Recommendations">
          <div className="ch-recent__head">
            <h2 className="ch-recent__title">Recommendations</h2>
            <button type="button" className="ch-recent__viewall" onClick={() => navigate('/shops?section=recommendations')}>
              View all
            </button>
          </div>

          {recsLoading ? (
            <p className="ch-recent__empty">Loading picks for you…</p>
          ) : recommendations.length === 0 ? (
            <p className="ch-recent__empty">Browse the shop to get personalized recommendations.</p>
          ) : (
            <div className="ch-rec-grid">
              {recommendations.map((p) => (
                <RecProductCard key={p.id} product={p} onOpen={openProduct} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
