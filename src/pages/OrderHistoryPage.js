import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchCustomerUnifiedOrders } from '../lib/customerOrderFeed';
import { getCustomerSession } from '../lib/customerSession';
import { formatDeliveryCodeDisplay } from '../lib/deliveryConfirmationCode';
import { filterOrders, statusLabel } from '../data/mockOrders';
import './customerAccount.css';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
];

function badgeClass(status, statusText) {
  const text = String(statusText ?? statusLabel(status)).toLowerCase();
  if (status === 'cancelled' || text.includes('cancel')) return 'oh-badg oh-badg--cancelled';
  if (status === 'delivered' || text.includes('delivered')) return 'oh-badg oh-badg--delivered';
  if (text.includes('placed') || text.includes('pending') || text.includes('awaiting')) {
    return 'oh-badg oh-badg--placed';
  }
  if (status === 'transit' || status === 'active') return 'oh-badg oh-badg--active';
  return 'oh-badg oh-badg--active';
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M21 21v-5h-5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OrderHistoryPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [liveOrders, setLiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const session = getCustomerSession();
    const { orders, error } = await fetchCustomerUnifiedOrders(session);
    setLiveOrders(orders);
    if (error) setLoadError(error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
    }, 40000);
    return () => window.clearInterval(id);
  }, [load]);

  const list = useMemo(() => filterOrders(liveOrders, filter), [liveOrders, filter]);

  const onReorder = useCallback(
    (e, kind) => {
      e.stopPropagation();
      e.preventDefault();
      if (kind === 'shop') navigate('/shops');
      else if (kind === 'taxi' || kind === 'tuk') navigate('/home');
      else navigate('/request-delivery');
    },
    [navigate],
  );

  return (
    <div className="cust cust--orders">
      <header className="oh-nav">
        <h1 className="oh-nav__title">My Orders</h1>
        <button
          type="button"
          className="oh-nav__refresh"
          aria-label="Refresh orders"
          title="Refresh"
          onClick={() => load()}
          disabled={loading}
        >
          <RefreshIcon />
        </button>
      </header>

      <div className="oh-main">
        {loadError ? (
          <p className="oh-empty oh-empty--error" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="oh-tabs" role="tablist" aria-label="Order status">
          {FILTERS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={filter === t.id}
              className={filter === t.id ? 'oh-pill oh-pill--on' : 'oh-pill'}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="oh-list">
          {loading ? (
            <p className="oh-empty">Loading your orders…</p>
          ) : list.length === 0 ? (
            <p className="oh-empty">
              {liveOrders.length === 0
                ? 'No orders yet. Book delivery, taxi, tuk-tuk, or shop — they will show here when linked to your account.'
                : 'No orders in this list.'}
            </p>
          ) : (
            list.map((o) => (
              <div
                key={o.navKey}
                className="oh-card"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/order/${encodeURIComponent(o.navKey)}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/order/${encodeURIComponent(o.navKey)}`);
                  }
                }}
              >
                <div className="oh-card__top">
                  <h2 className="oh-card__id">{o.id}</h2>
                  <span className={badgeClass(o.status, o.statusText)}>
                    {o.statusText ?? statusLabel(o.status)}
                  </span>
                </div>
                {o.subtitle ? <p className="oh-card__sub">{o.subtitle}</p> : null}
                {o.deliveryConfirmationCode &&
                o.status !== 'delivered' &&
                o.status !== 'cancelled' ? (
                  <div className="oh-code" aria-label="Delivery PIN">
                    <span className="oh-code__label">Delivery PIN</span>
                    <span className="oh-code__value">{formatDeliveryCodeDisplay(o.deliveryConfirmationCode)}</span>
                  </div>
                ) : null}
                {o.status === 'cancelled' && o.cancelReason ? (
                  <p className="oh-cancelReason" role="status">
                    {o.cancelledBy === 'driver' ? 'Driver cancelled' : 'Cancelled'}
                    {' — '}
                    {o.cancelReason}
                  </p>
                ) : null}
                <div className="oh-locs">
                  <span className="oh-locs__line" aria-hidden />
                  <div className="oh-addr">
                    <span className="oh-dot oh-dot--pickup" aria-hidden />
                    <span className="oh-addr__text">{o.from}</span>
                  </div>
                  <div className="oh-addr oh-addr--drop">
                    <span className="oh-dot oh-dot--drop" aria-hidden />
                    <span className="oh-addr__text">{o.to}</span>
                  </div>
                </div>
                {o.driver ? (
                  <div className="oh-driver">
                    <p className="oh-driver__label">Your driver</p>
                    <p className="oh-driver__name">{o.driver.name}</p>
                    <p className="oh-driver__meta">
                      {o.driver.phone} · {o.driver.vehicle} · {o.driver.plate}
                    </p>
                  </div>
                ) : null}
                <div className="oh-btm">
                  <span className="oh-date">{o.date}</span>
                  <span className="oh-pr">{o.price}</span>
                  <button type="button" className="oh-reorder" onClick={(e) => onReorder(e, o.kind)}>
                    Book again
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
