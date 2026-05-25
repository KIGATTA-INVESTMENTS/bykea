import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isAdminSignedIn, markAdminSignedOut } from '../../lib/adminAuth';
import InGoLogo from '../InGoLogo';
import { AdminHeaderActionsProvider, useAdminHeaderActions } from './adminHeaderActions';
import '../../pages/adminPortal.css';
import '../../pages/adminSidebarPremium.css';
import '../../pages/adminDesignSystem.css';

function Icon({ path }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const sectionItems = [
  {
    label: 'MAIN',
    items: [
      { to: '/admin/dashboard', name: 'Dashboard', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
      { to: '/admin/analytics', name: 'Analytics', icon: 'M4 19V5M4 19h16M8 14l3-3 3 2 4-5' },
    ],
  },
  {
    label: 'MANAGEMENT',
    items: [
      { to: '/admin/customers', name: 'Customers', icon: 'M17 20a4 4 0 0 0-8 0M13 7a3 3 0 1 1-6 0M20 20a4 4 0 0 0-3-3.9M17 5a3 3 0 1 1 0 6' },
      {
        to: '/admin/driver-requests',
        name: 'Driver requests',
        icon: 'M4 6h16v4H4zM4 14h10v4H4zM16 14h4v4h-4zM8 10h12M8 18h4',
      },
      {
        to: '/admin/our-drivers',
        name: 'Drivers',
        icon: 'M8 11a4 4 0 1 1 8 0M6 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1M4 20h16',
      },
      { to: '/admin/shop-owners', name: 'Shop Owners', icon: 'M3 11h18M5 11v8h14v-8M4 11l8-5 8 5' },
      {
        to: '/admin/delivery-orders',
        name: 'Delivery orders',
        icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4-4H9v4zM9 5v4h6',
      },
      {
        to: '/admin/shop-orders',
        name: 'Shop orders',
        icon: 'M6 6h15M6 6v12h15V6M6 6L3 3v18l3-3M9 10h9M9 14h6',
      },
      {
        to: '/admin/shop-orders-delivery',
        name: 'Shop orders delivery',
        icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4-4H9v4zM9 5v4h6M12 12v6M12 12l-3 3M12 12l3 3',
      },
      {
        to: '/admin/taxi-bookings',
        name: 'Taxi bookings',
        icon: 'M5 17h14M5 17a2 2 0 1 1 4 0M15 17a2 2 0 1 1 4 0M7 11h10l1 3H6l1-3z',
      },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { to: '/admin/payments', name: 'Payments', icon: 'M12 2v20M17 6a4 4 0 0 0-8 0c0 2 2 3 4 3s4 1 4 3a4 4 0 0 1-8 0' },
      { to: '/admin/driver-withdrawals', name: 'Driver withdrawals', icon: 'M6 12h12M12 6l6 6-6 6M4 5h4M4 19h4' },
      { to: '/admin/shop-withdrawals', name: 'Shop withdrawals', icon: 'M6 12h12M12 6l6 6-6 6M4 5h4M4 19h4' },
      { to: '/admin/transactions', name: 'Transactions', icon: 'M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7' },
      { to: '/admin/service-rates', name: 'Service rates', icon: 'M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4' },
      {
        to: '/admin/platform-commission',
        name: 'Platform commission',
        icon: 'M12 2v20M7 7h10M7 12h6M7 17h8',
      },
      {
        to: '/admin/shop-delivery-price',
        name: 'Shop delivery price',
        icon: 'M6 18h12M8 18V9l4-3 4 3v9M9 22h6',
      },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/admin/reviews', name: 'Reviews', icon: 'M12 17.3 5.8 20l1.1-6.7L2 8.6l6.8-1 3.2-6.1 3.2 6.1 6.8 1-4.9 4.7 1.1 6.7z' },
      { to: '/admin/communications', name: 'Communications', icon: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/admin/reports', name: 'Reports', icon: 'M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6' },
    ],
  },
];

function TopBar({ title, onMenuClick }) {
  const { actions } = useAdminHeaderActions() || { actions: null };
  return (
    <header className="admTopbar">
      <button className="admIconBtn admMenuBtn" type="button" aria-label="Open menu" onClick={onMenuClick}>
        <Icon path="M4 7h16M4 12h16M4 17h16" />
      </button>
      <h1 className="admTopbar__title">{title}</h1>
      <div className="admTopbar__actions">{actions}</div>
      <div className="admTopbar__avatar-wrap">
        <div className="admTopbar__avatar" aria-hidden>
          SA
        </div>
        <span className="admTopbar__online" aria-hidden />
      </div>
    </header>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitle = location.pathname.includes('/admin/customers')
    ? 'Customer Management'
    : location.pathname.includes('/admin/our-drivers')
      ? 'Drivers'
      : location.pathname.includes('/admin/driver-requests')
        ? 'Driver requests'
        : location.pathname.includes('/admin/drivers')
          ? 'Driver Management'
          : location.pathname.includes('/admin/delivery-orders')
        ? 'Delivery orders'
        : location.pathname.includes('/admin/shop-orders-delivery')
          ? 'Shop orders delivery'
        : location.pathname.includes('/admin/shop-orders')
          ? 'Shop orders'
        : location.pathname.includes('/admin/tuk-tuk-bookings')
          ? 'Tuk-Tuk bookings'
          : location.pathname.includes('/admin/taxi-bookings')
            ? 'Taxi bookings'
            : location.pathname.includes('/admin/orders')
            ? 'Order Management'
          : location.pathname.includes('/admin/pricing')
            ? 'Pricing Configuration'
          : location.pathname.includes('/admin/service-rates')
            ? 'Service rates'
            : location.pathname.includes('/admin/platform-commission')
              ? 'Platform commission'
            : location.pathname.includes('/admin/shop-delivery-price')
              ? 'Shop delivery price'
            : location.pathname.includes('/admin/payments')
              ? 'Payments & Transactions'
            : location.pathname.includes('/admin/driver-withdrawals')
              ? 'Driver withdrawals'
            : location.pathname.includes('/admin/shop-withdrawals')
              ? 'Shop withdrawals'
            : location.pathname.includes('/admin/analytics')
              ? 'Analytics'
              : location.pathname.includes('/admin/shop-owners')
                ? 'Shop Owners'
                : location.pathname.includes('/admin/transactions')
                  ? 'Transactions'
                  : location.pathname.includes('/admin/disputes')
                    ? 'Disputes & Support'
                    : location.pathname.includes('/admin/support')
                      ? 'Support Tickets'
                        : location.pathname.includes('/admin/reviews')
                          ? 'Reviews'
                      : location.pathname.includes('/admin/notifications')
                        ? 'Notifications'
                        : location.pathname.includes('/admin/communications')
                          ? 'Communications'
                          : location.pathname.includes('/admin/reports')
                            ? 'Reports'
                            : location.pathname.includes('/admin/settings')
                              ? 'Settings'
                              : location.pathname.includes('/admin/system-health')
                                ? 'System Health'
      : 'Dashboard';

  if (!isAdminSignedIn()) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  const handleLogout = () => {
    markAdminSignedOut();
    navigate('/admin/login', { replace: true });
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminHeaderActionsProvider>
    <div className="adm admShell">
      {sidebarOpen ? <button type="button" className="admSidebarOverlay" aria-label="Close menu" onClick={closeSidebar} /> : null}
      <aside className={`admSidebar${sidebarOpen ? ' admSidebar--open' : ''}`}>
        <div className="admSidebar__head">
          <div className="admBrand">
            <InGoLogo variant="adminSidebar" />
            <span className="admAdminBadge">Admin</span>
          </div>
          <div className="admProfile">
            <div className="admSidebarAvatar" aria-hidden>
              SA
            </div>
            <div className="admProfile__text">
              <div className="admProfile__name">Shuaib Admin</div>
              <span className="admRole">Super Admin</span>
            </div>
          </div>
        </div>
        <div className="admSidebar__scroll">
          {sectionItems.map((section, sectionIdx) => (
            <div key={section.label} className="admNavSection">
              {sectionIdx > 0 ? <div className="admNavDivider" role="presentation" /> : null}
              <div className="admNavLabel">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `admNavItem${isActive ? ' active' : ''}`}
                  onClick={closeSidebar}
                >
                  <Icon path={item.icon} />
                  {item.name}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="admNavDivider" role="presentation" />
          <button className="admNavItem admDanger" type="button" onClick={handleLogout}>
            <Icon path="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
            Logout
          </button>
        </div>
      </aside>
      <main className="admMain">
        <TopBar title={pageTitle} onMenuClick={() => setSidebarOpen((v) => !v)} />
        <div className="admContent">
          <Outlet />
        </div>
      </main>
    </div>
    </AdminHeaderActionsProvider>
  );
}
