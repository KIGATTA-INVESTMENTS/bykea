import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  clearCustomerSession,
  getCustomerSession,
  getSessionEmail,
  isCustomerMarkedSignedIn,
  saveCustomerSession,
} from '../lib/customerSession';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './profilePremium.css';

const TABS = [
  { id: 'account', label: 'Account' },
  { id: 'activity', label: 'Activity' },
  { id: 'help', label: 'Help' },
];

function formatPhoneDisplay(phone) {
  const p = String(phone || '').trim();
  if (!p) return '—';
  if (p.startsWith('+')) return p;
  return `+44 ${p}`;
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

function RowChevron() {
  return (
    <span className="prf-row__chev" aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path
          d="M9.5 7.5L14 12l-4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 1.5v2.8M12 19.7v2.8M4.2 4.2l2 2M17.8 17.8l2 2M1.5 12h2.8M19.7 12h2.8M4.2 19.8l2-2M17.8 6.2l2-2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c.6-3.2 3-5 7-5s6.4 1.8 7 5" strokeLinecap="round" />
    </svg>
  );
}

function IconOrders() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 4.5a4 4 0 0 0-4 4v2.5L6 14.5h12l-2-3.5V8.5a4 4 0 0 0-4-4Z" strokeLinejoin="round" />
      <path d="M10 18.5h4" strokeLinecap="round" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 4.2 1.8c-.8.6-1.2 1.2-1.2 2.2V15" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5 6.5h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" strokeLinejoin="round" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M16 4v4h4M9 12h6M9 16h6" strokeLinecap="round" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17" strokeLinejoin="round" />
      <path d="M4 12h10M7.5 8.5 4 12l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden>
      <rect x="2.5" y="6" width="18" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

function MenuRow({ icon, label, meta, onClick }) {
  return (
    <button type="button" className="prf-row" onClick={onClick}>
      <span className="prf-row__icon">{icon}</span>
      <span className="prf-row__label">{label}</span>
      {meta ? <span className="prf-row__meta">{meta}</span> : null}
      <RowChevron />
    </button>
  );
}

const TAB_PANELS = {
  account: [
    {
      key: 'edit',
      icon: <IconPerson />,
      label: 'Personal information',
      meta: 'Name, phone, email',
      to: '/profile/edit',
    },
    {
      key: 'privacy',
      icon: <IconDoc />,
      label: 'Privacy policy',
      to: '/privacy-policy',
    },
    {
      key: 'terms',
      icon: <IconDoc />,
      label: 'Terms of service',
      to: '/terms',
    },
  ],
  activity: [
    {
      key: 'orders',
      icon: <IconOrders />,
      label: 'Order history',
      meta: 'Deliveries, rides & shops',
      to: '/orders',
    },
    {
      key: 'notifications',
      icon: <IconBell />,
      label: 'Notifications',
      meta: 'Updates on your trips',
      to: '/notifications',
    },
  ],
  help: [
    {
      key: 'support',
      icon: <IconHelp />,
      label: 'Help & support',
      to: '/help-support',
    },
    {
      key: 'faqs',
      icon: <IconHelp />,
      label: 'FAQs',
      to: '/faqs',
    },
    {
      key: 'chat',
      icon: <IconChat />,
      label: 'Chat with support',
      meta: 'Live help',
      to: '/chat/support',
    },
  ],
};

export default function ProfilePage() {
  const [profile, setProfile] = useState(() => getCustomerSession());
  const [activeTab, setActiveTab] = useState('account');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const cached = getCustomerSession();
    if (cached) setProfile(cached);

    async function loadFromSupabase() {
      if (!isSupabaseConfigured || !supabase) return;

      const selectCols = 'id, full_name, phone, email, profile_photo_url';
      let row = null;

      if (cached?.id) {
        const { data, error } = await supabase
          .from('app_users')
          .select(selectCols)
          .eq('id', cached.id)
          .maybeSingle();
        if (!cancelled && !error) {
          if (data) row = data;
          else if (cached?.id) {
            clearCustomerSession();
            setProfile(null);
            return;
          }
        }
      }

      if (!row && isCustomerMarkedSignedIn()) {
        const email = getSessionEmail();
        if (email) {
          const { data, error } = await supabase
            .from('app_users')
            .select(selectCols)
            .eq('email', email)
            .maybeSingle();
          if (!cancelled && !error) {
            if (data) row = data;
            else {
              clearCustomerSession();
              setProfile(null);
              return;
            }
          }
        }
      }

      if (cancelled || !row) return;
      saveCustomerSession(row);
      setProfile(row);
    }

    loadFromSupabase();
    return () => {
      cancelled = true;
    };
  }, []);

  const display = useMemo(() => {
    const name = profile?.full_name?.trim() || '';
    const email = profile?.email?.trim() || '';
    return {
      name: name || 'Guest',
      phone: formatPhoneDisplay(profile?.phone),
      email: email || '—',
      initials: initialsFromName(name),
      photoUrl: profile?.profile_photo_url?.trim() || null,
    };
  }, [profile]);

  const showSessionHint = useMemo(() => {
    return isCustomerMarkedSignedIn() && !profile?.id && !getSessionEmail();
  }, [profile]);

  const panelRows = TAB_PANELS[activeTab] || [];

  const logout = () => {
    clearCustomerSession();
    navigate('/login', { replace: true });
  };

  return (
    <div className="prf-page" role="main" aria-label="Profile">
      <header className="prf-nav">
        <span aria-hidden />
        <h1 className="prf-nav__title">Profile</h1>
        <button
          type="button"
          className="prf-nav__settings"
          aria-label="Edit profile"
          onClick={() => navigate('/profile/edit')}
        >
          <IconGear />
        </button>
      </header>

      <div className="prf-hero">
        <div className="prf-avatar-wrap">
          {display.photoUrl ? (
            <img
              src={display.photoUrl}
              alt=""
              className="prf-avatar prf-avatar--img"
            />
          ) : (
            <div className="prf-avatar" aria-label="Profile photo">
              {display.initials}
            </div>
          )}
          <button
            type="button"
            className="prf-avatar__btn"
            aria-label="Change profile photo"
            title="Change photo"
            onClick={() => navigate('/profile/edit')}
          >
            <CameraIcon />
          </button>
        </div>
        <div className="prf-identity">
          <h2 className="prf-identity__name">{display.name}</h2>
          {display.email && display.email !== '—' ? (
            <p className="prf-identity__email">{display.email}</p>
          ) : null}
          <p className="prf-identity__phone">{display.phone}</p>
          {showSessionHint ? (
            <p className="prf-identity__hint">
              Log in once on this device to load your saved details from your account.
            </p>
          ) : null}
        </div>
      </div>

      <div className="prf-tabs" role="tablist" aria-label="Profile sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`prf-tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`prf-panel-${t.id}`}
            className={activeTab === t.id ? 'prf-tab prf-tab--active' : 'prf-tab'}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="prf-scroll">
        <div
          role="tabpanel"
          id={`prf-panel-${activeTab}`}
          aria-labelledby={`prf-tab-${activeTab}`}
          className="prf-panel"
        >
          <div className="prf-card">
            {panelRows.map((row) => (
              <MenuRow
                key={row.key}
                icon={row.icon}
                label={row.label}
                meta={row.meta}
                onClick={() => navigate(row.to)}
              />
            ))}
          </div>
        </div>

        <button type="button" className="prf-logout" onClick={logout}>
          <span className="prf-logout__icon">
            <IconLogout />
          </span>
          <span className="prf-logout__label">Log Out</span>
        </button>
      </div>
    </div>
  );
}
