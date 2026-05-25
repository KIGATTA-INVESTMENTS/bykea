import { NavLink } from 'react-router-dom';
import './DriverApp.css';

const cOn = '#EC6C23';
const cOff = '#9ca3af';

function IconHome({ isOn }) {
  const c = isOn ? cOn : cOff;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-7H9v7H5a1 1 0 0 1-1-1v-9.5Z"
        stroke={c}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconList({ isOn }) {
  const c = isOn ? cOn : cOff;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="3" rx="0.4" fill={c} />
      <rect x="4" y="10.2" width="12" height="2.6" rx="0.3" fill={c} />
      <rect x="4" y="16" width="16" height="2.5" rx="0.3" fill={c} />
    </svg>
  );
}
function IconEarnings({ isOn }) {
  const c = isOn ? cOn : cOff;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="1" stroke={c} strokeWidth="1.4" fill="none" />
      <path d="M3 9h18" stroke={c} strokeWidth="1" />
    </svg>
  );
}
function IconUser({ isOn }) {
  const c = isOn ? cOn : cOff;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3" stroke={c} strokeWidth="1.4" fill="none" />
      <path
        d="M5.5 20.5c.8-2.5 2.4-3.2 6.5-3.2s5.4.6 6.1 2.2"
        stroke={c}
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
function IconWallet({ isOn }) {
  const c = isOn ? cOn : cOff;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="1.2" stroke={c} strokeWidth="1.4" fill="none" />
      <path d="M3 9.5h18" stroke={c} strokeWidth="1.1" />
      <circle cx="16.2" cy="12.2" r="0.7" fill={c} />
    </svg>
  );
}

const items = [
  { to: '/driver/home', end: true, label: 'Home', Icon: IconHome },
  { to: '/driver/orders', label: 'Orders', Icon: IconList },
  { to: '/driver/earnings', label: 'Earnings', Icon: IconEarnings },
  { to: '/driver/wallet', label: 'Wallet', Icon: IconWallet },
  { to: '/driver/profile', label: 'Profile', Icon: IconUser },
];

export default function DriverBottomNav() {
  return (
    <nav className="dnav" aria-label="Driver main">
      {items.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => (isActive ? 'dnav__item dnav__item--on' : 'dnav__item')}
        >
          {({ isActive }) => (
            <>
              <span className="dnav__ic" aria-hidden>
                <Icon isOn={isActive} />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
