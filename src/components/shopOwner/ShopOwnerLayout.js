import { useState } from 'react';
import { Link, NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  clearShopOwnerSession,
  getShopOwnerSession,
  isShopOwnerSignedIn,
} from '../../lib/shopOwnerAuth';
import InGoLogo from '../InGoLogo';
import '../../pages/shopOwnerPortal.css';
import '../../pages/shopOwnerSidebarPremium.css';

function NavIcon({ children }) {
  return (
    <span className="sopNav-icon" aria-hidden>
      {children}
    </span>
  );
}

function IcHome() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-7H9v7H5a1 1 0 0 1-1-1v-9.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </NavIcon>
  );
}

function IcBox() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 9.5h16" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </NavIcon>
  );
}

function IcTag2() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M4.5 5.5L12 3.5l7.5 2v12.5a1.2 1.2 0 0 1-1.2 1.2H5.7A1.2 1.2 0 0 1 4.5 18V5.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M8.5 8.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </NavIcon>
  );
}

function IcScooter() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="6.5" cy="17" r="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="17.5" cy="17" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8.5 17h7M6.5 17V11l3-4h4l2 3h3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12 7V5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </NavIcon>
  );
}

function IcWallet() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 9.5h18" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16" cy="12" r="1" fill="currentColor" />
      </svg>
    </NavIcon>
  );
}

function IcChart() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 20V5M4 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="6" y="12" width="3" height="5" rx="0.5" fill="currentColor" />
        <rect x="10.5" y="9" width="3" height="8" rx="0.5" fill="currentColor" />
        <rect x="15" y="11" width="3" height="6" rx="0.5" fill="currentColor" />
      </svg>
    </NavIcon>
  );
}

function IcGear() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M12 4.5v2M12 17.5v2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M4.5 12h2M17.5 12h2M6.5 17.5l1.4-1.4M16.1 7.9l1.4-1.4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </NavIcon>
  );
}

function IcChat() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4.2 3.1c-.5.4-1.2 0-.9-.7l1-2.4H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </NavIcon>
  );
}

function IcLogout() {
  return (
    <NavIcon>
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </NavIcon>
  );
}

function IcHamb() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcBell() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2ZM10 18a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const nav = [
  { to: '/shop-owner/dashboard', label: 'Dashboard', Icon: IcHome, end: true },
  { to: '/shop-owner/orders', label: 'Orders', Icon: IcBox },
  { to: '/shop-owner/delivery-driver', label: 'Delivery Driver', Icon: IcScooter },
  { to: '/shop-owner/products', label: 'Products', Icon: IcTag2 },
  { to: '/shop-owner/payments', label: 'Payments', Icon: IcWallet },
  { to: '/shop-owner/analytics', label: 'Analytics', Icon: IcChart },
  { to: '/shop-owner/chat', label: 'Chat', Icon: IcChat },
  { to: '/shop-owner/profile', label: 'Profile & Settings', Icon: IcGear },
];

function shopAvatarInitials(name) {
  const s = String(name || '').trim();
  if (!s) return 'SH';
  if (s.length >= 2) return s.slice(0, 2).toUpperCase();
  return s[0].toUpperCase();
}

export default function ShopOwnerLayout() {
  const [sbOpen, setSbOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();

  if (!isShopOwnerSignedIn()) {
    return <Navigate to="/shop-owner/login" replace state={{ from: loc }} />;
  }

  const closeSb = () => setSbOpen(false);
  const logout = () => {
    clearShopOwnerSession();
    navigate('/shop-owner/login', { replace: true });
  };

  const profile = getShopOwnerSession();
  const shopLabel = profile?.business_name?.trim() || 'Your shop';
  const shopInitial = (shopLabel.charAt(0) || 'S').toUpperCase();
  const shopAvatarText = shopAvatarInitials(shopLabel);
  const portalPremiumRoutes = [
    '/shop-owner/dashboard',
    '/shop-owner/orders',
    '/shop-owner/delivery-driver',
    '/shop-owner/products',
    '/shop-owner/products/new',
    '/shop-owner/payments',
    '/shop-owner/analytics',
    '/shop-owner/chat',
    '/shop-owner/support/chat',
    '/shop-owner/profile',
    '/shop-owner/notifications',
  ];
  const portalChatRoutes = ['/shop-owner/chat', '/shop-owner/support/chat'];
  const isPortalChat = portalChatRoutes.includes(loc.pathname);
  const isPortalProfile = loc.pathname === '/shop-owner/profile';
  const isPortalPremium =
    portalPremiumRoutes.includes(loc.pathname) || loc.pathname.startsWith('/shop-owner/orders/');
  const isPortalPadded =
    !isPortalChat && !isPortalProfile && loc.pathname !== '/shop-owner/dashboard';

  return (
    <div className={`sop sopShell${isPortalPremium ? ' sopShell--portal-premium' : ''}`}>
      {sbOpen && (
        <div className="sopOvl sopOvl--on" onClick={closeSb} role="presentation" aria-hidden />
      )}
      <aside className={sbOpen ? 'sopSb sopSb--premium sopSb--open' : 'sopSb sopSb--premium'}>
        <div className="sopSb-head">
          <NavLink to="/shop-owner/dashboard" className="sopSb-logo" onClick={closeSb}>
            <InGoLogo variant="shopSidebar" />
          </NavLink>
          <div className="sopSb-profile">
            <div className="sopSb-avWrap">
              <div className="sopSb-av" aria-hidden>
                {shopAvatarText}
              </div>
              <span className="sopSb-avBadge" aria-hidden>
                {shopInitial}
              </span>
            </div>
            <div className="sopSb-nm">{shopLabel}</div>
          </div>
        </div>
        <nav className="sopNav sopNav--premium" aria-label="Shop owner">
          {nav.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={!!end}
              className={({ isActive }) => (isActive ? 'sopNav--on' : '')}
              onClick={closeSb}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sopSb-foot">
          <button type="button" className="sopSb-logout" onClick={logout}>
            <IcLogout />
            Logout
          </button>
        </div>
      </aside>
      <div className="sopMain">
        <header className={isPortalPremium ? 'sopTop sopTop--portal-premium' : 'sopTop'}>
          <button
            type="button"
            className={isPortalPremium ? 'sopHamb sopHamb--portal' : 'sopHamb'}
            aria-label="Open menu"
            onClick={() => setSbOpen((o) => !o)}
          >
            <IcHamb />
          </button>
          <h1 className={isPortalPremium ? 'sopGreet sopGreet--portal' : 'sopGreet'}>
            {isPortalPremium ? shopLabel : `Hy ${shopLabel}`}
          </h1>
          {isPortalPremium ? (
            <Link to="/shop-owner/notifications" className="sopTopBell" aria-label="Notifications">
              <IcBell />
            </Link>
          ) : null}
        </header>
        <div
          className={
            isPortalPremium
              ? isPortalChat
                ? 'sopCont sopCont--portal-chat'
                : isPortalProfile
                  ? 'sopCont sopCont--portal-premium'
                  : isPortalPadded
                    ? 'sopCont sopCont--portal-padded'
                    : 'sopCont sopCont--portal-premium'
              : 'sopCont'
          }
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
