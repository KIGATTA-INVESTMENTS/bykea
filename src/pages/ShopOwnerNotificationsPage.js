import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchShopOwnerNotifications,
  markShopOwnerNotificationsRead,
} from '../lib/shopOwnerNotifications';
import './shopOwnerDashboardPremium.css';
import './shopOwnerNotificationsPremium.css';
import './notificationsPremium.css';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'orders', label: 'Orders' },
  { id: 'payments', label: 'Payments' },
  { id: 'alerts', label: 'Alerts' },
];

const TYPE_STYLE = {
  order: { bg: '#EC6C23' },
  delivery: { bg: '#07408F' },
  payment: { bg: '#EC6C23' },
  alert: { bg: '#07408F' },
  delivered: { bg: '#16a34a' },
  cancel: { bg: '#dc2626' },
  chat: { bg: '#07408F' },
};

const GROUP_LABEL = { today: 'TODAY', yesterday: 'YESTERDAY', older: 'EARLIER' };

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

function IconWallet() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path
        d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4.2 3.1c-.5.4-1.2 0-.9-.7l1-2.4H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z"
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

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 4v8M12 16h.01" strokeLinecap="round" />
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" strokeLinejoin="round" />
    </svg>
  );
}

function TypeIcon({ type }) {
  switch (type) {
    case 'payment':
      return <IconWallet />;
    case 'chat':
      return <IconChat />;
    case 'delivered':
      return <IconCheck />;
    case 'cancel':
      return <IconCancel />;
    case 'alert':
      return <IconAlert />;
    default:
      return <IconPackage />;
  }
}

function NotifCard({ n, onOpen }) {
  const st = TYPE_STYLE[n.type] || TYPE_STYLE.order;
  return (
    <article
      className={!n.read ? 'ntf-card ntf-card--unread sopntf-card--click' : 'ntf-card sopntf-card--click'}
      role={n.link ? 'button' : undefined}
      tabIndex={n.link ? 0 : undefined}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => {
        if (!n.link) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(n);
        }
      }}
    >
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

export default function ShopOwnerNotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { items: rows, error } = await fetchShopOwnerNotifications();
    setItems(rows);
    setLoadError(error || '');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAllRead = useCallback(() => {
    const ids = items.map((i) => i.id);
    markShopOwnerNotificationsRead(ids);
    setItems((list) => list.map((i) => ({ ...i, read: true })));
  }, [items]);

  const openNotif = useCallback(
    (n) => {
      if (!n.read) {
        markShopOwnerNotificationsRead([n.id]);
        setItems((list) => list.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      }
      if (n.link) navigate(n.link);
    },
    [navigate],
  );

  const filtered = useMemo(() => {
    if (tab === 'all') return items;
    return items.filter((n) => n.category === tab);
  }, [items, tab]);

  const grouped = useMemo(() => {
    const o = { today: [], yesterday: [], older: [] };
    for (const n of filtered) {
      if (o[n.group]) o[n.group].push(n);
      else o.older.push(n);
    }
    return o;
  }, [filtered]);

  const hasItems = filtered.length > 0;
  const hasAny = items.length > 0;

  return (
    <div className="sopntf-page" role="main" aria-label="Notifications">
      <header className="sopntf-head">
        <h1>Notifications</h1>
        <div className="sopntf-head-actions">
          <button type="button" className="sopntf-refresh" onClick={load} disabled={loading} aria-label="Refresh">
            Refresh
          </button>
          <button
            type="button"
            className="sopntf-mark"
            onClick={markAllRead}
            disabled={!hasAny || items.every((i) => i.read) || loading}
          >
            Mark all as read
          </button>
        </div>
      </header>

      {loadError ? (
        <p className="sopntf-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="sopntf-tabs ntf-tabs" role="tablist" aria-label="Filter notifications">
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

      <div className="sopntf-scroll">
        {loading ? (
          <p className="sopntf-loading" role="status">
            Loading notifications…
          </p>
        ) : !hasItems ? (
          <div className="ntf-empty">
            <div className="ntf-empty__icon" aria-hidden>
              <BellEmpty />
            </div>
            <p className="ntf-empty__title">No notifications yet</p>
            <p className="ntf-empty__sub">
              {loadError
                ? 'Fix the issue above and tap Refresh'
                : 'New orders, payouts, and admin messages will show up here'}
            </p>
          </div>
        ) : (
          <>
            {grouped.today.length > 0 && (
              <>
                <h2 className="ntf-group-label">{GROUP_LABEL.today}</h2>
                {grouped.today.map((n) => (
                  <NotifCard key={n.id} n={n} onOpen={openNotif} />
                ))}
              </>
            )}
            {grouped.yesterday.length > 0 && (
              <>
                <h2 className="ntf-group-label">{GROUP_LABEL.yesterday}</h2>
                {grouped.yesterday.map((n) => (
                  <NotifCard key={n.id} n={n} onOpen={openNotif} />
                ))}
              </>
            )}
            {grouped.older.length > 0 && (
              <>
                <h2 className="ntf-group-label">{GROUP_LABEL.older}</h2>
                {grouped.older.map((n) => (
                  <NotifCard key={n.id} n={n} onOpen={openNotif} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
