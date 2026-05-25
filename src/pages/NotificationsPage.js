import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './notificationsPremium.css';

const MOCK = [
  {
    id: '1',
    group: 'today',
    ago: '2 min ago',
    title: 'Your order has been picked up',
    sub: 'En route to your drop-off address',
    type: 'delivery',
    category: 'orders',
    read: false,
  },
  {
    id: '2',
    group: 'today',
    ago: '30 min ago',
    title: 'Driver is 2 mins away',
    sub: 'Please be ready at the pickup point',
    type: 'ride',
    category: 'rides',
    read: false,
  },
  {
    id: '3',
    group: 'today',
    ago: '1 hr ago',
    title: 'Payment of �$2.50 confirmed',
    sub: 'Thank you for your payment',
    type: 'payment',
    category: 'orders',
    read: true,
  },
  {
    id: '4',
    group: 'yesterday',
    ago: 'Yesterday · 4:20 PM',
    title: 'Get 20% off your next delivery!',
    sub: 'Use code INGO20 at checkout',
    type: 'promo',
    category: 'offers',
    read: true,
  },
  {
    id: '5',
    group: 'yesterday',
    ago: 'Yesterday · 2:10 PM',
    title: 'Order #ING-00234 delivered',
    sub: 'How was your experience? Tap to rate',
    type: 'delivered',
    category: 'orders',
    read: true,
  },
  {
    id: '6',
    group: 'yesterday',
    ago: 'Yesterday · 10:00 AM',
    title: 'Order #ING-00099 cancelled',
    sub: 'Your payment was refunded to your wallet',
    type: 'cancel',
    category: 'orders',
    read: true,
  },
];

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'orders', label: 'Orders' },
  { id: 'rides', label: 'Rides' },
  { id: 'offers', label: 'Offers' },
];

const TYPE_STYLE = {
  delivery: { bg: '#EC6C23' },
  payment: { bg: '#EC6C23' },
  ride: { bg: '#07408F' },
  promo: { bg: '#07408F' },
  delivered: { bg: '#16a34a' },
  cancel: { bg: '#dc2626' },
};

const GROUP_LABEL = { today: 'TODAY', yesterday: 'YESTERDAY' };

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M15.5 18.5L8.5 12l7-7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BellEmpty() {
  return (
    <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <path
        d="M12 3a4.5 4.5 0 0 0-4.5 4.5V10l-1.2 2.4A1 1 0 0 0 7.2 14h9.6a1 1 0 0 0 .9-1.6L17 10V7.5A4.5 4.5 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M10.5 18a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" strokeLinejoin="round" />
      <path d="M12 12 20 7.5M12 12V21M12 12 4 7.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCar() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 16h14l-1.2-5.2a2 2 0 0 0-2-1.6H8.2a2 2 0 0 0-2 1.6L5 16Z" strokeLinejoin="round" />
      <circle cx="8" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M6 11h12" strokeLinecap="round" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path
        d="M12 4.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 15.8l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7L12 4.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 12.5l3.5 3.5L18 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCancel() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M8 8l8 8M16 8l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function TypeIcon({ type }) {
  switch (type) {
    case 'ride':
      return <IconCar />;
    case 'promo':
      return <IconStar />;
    case 'payment':
      return <IconCard />;
    case 'delivered':
      return <IconCheck />;
    case 'cancel':
      return <IconCancel />;
    default:
      return <IconPackage />;
  }
}

function NotifCard({ n }) {
  const st = TYPE_STYLE[n.type] || TYPE_STYLE.delivery;
  return (
    <article className={!n.read ? 'ntf-card ntf-card--unread' : 'ntf-card'}>
      <div className="ntf-card__badge" style={{ background: st.bg }} aria-hidden>
        <TypeIcon type={n.type} />
      </div>
      <div className="ntf-card__body">
        <h3 className="ntf-card__title">{n.title}</h3>
        <p className="ntf-card__sub">{n.sub}</p>
        <p className="ntf-card__ago">{n.ago}</p>
      </div>
      {!n.read ? <span className="ntf-card__dot" aria-label="Unread" /> : null}
    </article>
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState(MOCK);
  const [tab, setTab] = useState('all');

  const markAllRead = useCallback(() => {
    setItems((list) => list.map((i) => ({ ...i, read: true })));
  }, []);

  const filtered = useMemo(() => {
    if (tab === 'all') return items;
    return items.filter((n) => n.category === tab);
  }, [items, tab]);

  const grouped = useMemo(() => {
    const o = { today: [], yesterday: [] };
    for (const n of filtered) {
      if (n.group === 'today') o.today.push(n);
      if (n.group === 'yesterday') o.yesterday.push(n);
    }
    return o;
  }, [filtered]);

  const hasItems = filtered.length > 0;
  const hasAny = items.length > 0;

  return (
    <div className="ntf-page" role="main" aria-label="Notifications">
      <header className="ntf-nav">
        <button type="button" className="ntf-nav__back" onClick={() => navigate(-1)} aria-label="Back">
          <BackArrow />
        </button>
        <h1 className="ntf-nav__title">Notifications</h1>
        <button
          type="button"
          className="ntf-nav__mark"
          onClick={markAllRead}
          disabled={!hasAny || items.every((i) => i.read)}
        >
          Mark all as read
        </button>
      </header>

      <div className="ntf-tabs" role="tablist" aria-label="Filter notifications">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'ntf-tab ntf-tab--active' : 'ntf-tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ntf-scroll">
        {!hasItems ? (
          <div className="ntf-empty">
            <div className="ntf-empty__icon" aria-hidden>
              <BellEmpty />
            </div>
            <p className="ntf-empty__title">No notifications yet</p>
            <p className="ntf-empty__sub">We will notify you about your orders and offers</p>
          </div>
        ) : (
          <>
            {grouped.today.length > 0 && (
              <>
                <h2 className="ntf-group-label">{GROUP_LABEL.today}</h2>
                {grouped.today.map((n) => (
                  <NotifCard key={n.id} n={n} />
                ))}
              </>
            )}
            {grouped.yesterday.length > 0 && (
              <>
                <h2 className="ntf-group-label">{GROUP_LABEL.yesterday}</h2>
                {grouped.yesterday.map((n) => (
                  <NotifCard key={n.id} n={n} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
