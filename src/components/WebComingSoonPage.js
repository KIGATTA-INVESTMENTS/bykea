import CarIcon from './icons/CarIcon';
import InGoLogo from './InGoLogo';
import './WebComingSoonPage.css';

function IconTukTuk() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" aria-hidden>
      <circle cx="12" cy="34" r="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="36" cy="34" r="5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8 28h28l4-8H18l-3-6H8v14Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M32 20v-4a3 3 0 0 1 6 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconShop() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" aria-hidden>
      <path
        d="M10 18h28v20a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V18Z"
        stroke="currentColor"
        strokeWidth="2"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <path d="M14 18V12a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const FEATURES = [
  {
    id: 'taxi',
    title: 'Taxi',
    hint: 'Book comfortable rides across town',
    Icon: () => <CarIcon size={40} color="currentColor" />,
    tone: 'blue',
  },
  {
    id: 'tuk',
    title: 'Tuk-Tuk',
    hint: 'Affordable quick trips nearby',
    Icon: IconTukTuk,
    tone: 'orange',
  },
  {
    id: 'shop',
    title: 'Shop',
    hint: 'Order from local stores online',
    Icon: IconShop,
    tone: 'green',
  },
];

/** Full-web desktop landing while Taxi, Tuk-Tuk and Shop are in development. */
export default function WebComingSoonPage() {
  return (
    <div className="web-soon" role="main" aria-label="InGo web coming soon">
      <div className="web-soon__glow web-soon__glow--a" aria-hidden />
      <div className="web-soon__glow web-soon__glow--b" aria-hidden />

      <div className="web-soon__inner">
        <header className="web-soon__brand">
          <InGoLogo variant="hero" className="web-soon__logo" />
          <p className="web-soon__tagline">Deliver. Ride. Shop.</p>
        </header>

        <section className="web-soon__hero">
          <p className="web-soon__eyebrow">Full web experience</p>
          <h1 className="web-soon__title">Coming Soon</h1>
          <p className="web-soon__lead">
            We&apos;re polishing Taxi, Tuk-Tuk and Shop for desktop. Delivery stays available on mobile —
            open InGo on your phone to send parcels today.
          </p>
        </section>

        <section className="web-soon__grid" aria-label="Services coming soon">
          {FEATURES.map(({ id, title, hint, Icon, tone }) => (
            <article key={id} className={`web-soon__card web-soon__card--${tone}`}>
              <span className="web-soon__card-icon" aria-hidden>
                <Icon />
              </span>
              <h2 className="web-soon__card-title">{title}</h2>
              <p className="web-soon__card-hint">{hint}</p>
              <span className="web-soon__card-badge">
                <span className="web-soon__card-badge-dot" aria-hidden />
                Coming Soon
              </span>
            </article>
          ))}
        </section>

        <p className="web-soon__foot">Admin portal is available on this device.</p>
      </div>
    </div>
  );
}
