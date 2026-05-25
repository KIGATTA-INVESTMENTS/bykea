import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CarIcon from '../components/icons/CarIcon';
import InGoLogo from '../components/InGoLogo';
import '../components/customer/CustomerApp.css';
import { getCustomerSession } from '../lib/customerSession';
import { fetchCustomerUnifiedOrders } from '../lib/customerOrderFeed';
import { statusLabel } from '../data/mockOrders';

/** First word of `full_name`, else email local-part — matches `app_users` / session shape. */
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

function orderDisplayName(order) {
  if (order.subtitle) return order.subtitle;
  if (order.kind === 'shop') return 'Shop order';
  if (order.kind === 'taxi' || order.kind === 'tuk') return 'Ride';
  if (order.kind === 'delivery') return 'Delivery';
  return order.id || 'Order';
}

function orderStatusBadgeClass(status, statusText) {
  const text = String(statusText || statusLabel(status) || '').toLowerCase();
  if (status === 'delivered' || text.includes('delivered')) return 'ch-ro__badge ch-ro__badge--delivered';
  if (text.includes('completed')) return 'ch-ro__badge ch-ro__badge--completed';
  return 'ch-ro__badge ch-ro__badge--completed';
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

function IconRideCar() {
  return (
    <span style={{ color: '#07408F', display: 'flex' }}>
      <CarIcon size={26} />
    </span>
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

function IconFood() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path d="M8 4v8M6 4v2M10 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 4c1.5 2 2 4 2 7v9H12V11c0-3 .5-5 2-7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconOrderCar() {
  return <CarIcon size={20} color="currentColor" />;
}

function IconOrderShop() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path d="M5 10h14l-1-4H6L5 10Zm0 0v8h14v-8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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
  { id: 'taxi', label: 'Ride', subtitle: 'Get a ride', Icon: IconRideCar, iconClass: 'ch-svc-card__icon ch-svc-card__icon--blue' },
  { id: 'shop', label: 'Shop', subtitle: 'Shop online', Icon: IconShopBag, iconClass: 'ch-svc-card__icon ch-svc-card__icon--green' },
];

const RECENT_LIMIT = 4;

export default function CustomerHomePage() {
  const navigate = useNavigate();
  const displayName = useMemo(() => greetingFirstName(getCustomerSession()), []);
  const [activeService, setActiveService] = useState('delivery');
  const [recentOrders, setRecentOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const loadRecentOrders = useCallback(async () => {
    setOrdersLoading(true);
    const session = getCustomerSession();
    const { orders } = await fetchCustomerUnifiedOrders(session);
    setRecentOrders((orders || []).slice(0, RECENT_LIMIT));
    setOrdersLoading(false);
  }, []);

  useEffect(() => {
    loadRecentOrders();
  }, [loadRecentOrders]);

  const onServiceClick = (id) => {
    setActiveService(id);
    if (id === 'delivery') navigate('/request-delivery');
    if (id === 'taxi') navigate('/book-ride');
    if (id === 'shop') navigate('/shops');
  };

  const orderKindIcon = (kind) => {
    if (kind === 'taxi' || kind === 'tuk') return <IconOrderCar />;
    if (kind === 'shop') return <IconOrderShop />;
    return <IconFood />;
  };

  const orderKindIconClass = (kind) => {
    if (kind === 'taxi' || kind === 'tuk') return 'ch-ro__icon ch-ro__icon--blue';
    if (kind === 'shop') return 'ch-ro__icon ch-ro__icon--green';
    return 'ch-ro__icon ch-ro__icon--orange';
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
            {services.map(({ id, label, subtitle, Icon, iconClass }) => (
              <button
                key={id}
                type="button"
                className={`ch-svc-card${activeService === id ? ' ch-svc-card--active' : ''}`}
                aria-label={label}
                onClick={() => onServiceClick(id)}
              >
                <span className={iconClass}>
                  <Icon />
                </span>
                <span className="ch-svc-card__label">{label}</span>
                <span className="ch-svc-card__sub">{subtitle}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ch-promo-banner" aria-label="About InGo">
          <div className="ch-promo-banner__text">
            <p className="ch-promo-banner__off">Your local delivery partner</p>
            <p className="ch-promo-banner__line">Send parcels, book rides, and shop from stores near you — all in one app.</p>
          </div>
          <PromoBannerIcon />
        </section>

        <section className="ch-recent" aria-label="Recent orders">
          <div className="ch-recent__head">
            <h2 className="ch-recent__title">Recent Orders</h2>
            <button type="button" className="ch-recent__viewall" onClick={() => navigate('/orders')}>
              View all
            </button>
          </div>

          {ordersLoading ? (
            <p className="ch-recent__empty">Loading orders…</p>
          ) : recentOrders.length === 0 ? (
            <p className="ch-recent__empty">No orders yet. Book a delivery, ride, or shop order to see them here.</p>
          ) : (
            <ul className="ch-recent__list">
              {recentOrders.map((o) => (
                <li key={o.navKey}>
                  <button
                    type="button"
                    className="ch-ro"
                    onClick={() => navigate(`/order/${encodeURIComponent(o.navKey)}`)}
                  >
                    <span className={orderKindIconClass(o.kind)} aria-hidden>
                      {orderKindIcon(o.kind)}
                    </span>
                    <span className="ch-ro__body">
                      <span className="ch-ro__name">{orderDisplayName(o)}</span>
                      <span className="ch-ro__date">{o.date}</span>
                      <span className={orderStatusBadgeClass(o.status, o.statusText)}>
                        {o.statusText || statusLabel(o.status)}
                      </span>
                    </span>
                    <span className="ch-ro__price">{o.price}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
