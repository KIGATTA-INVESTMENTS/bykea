import { Link } from 'react-router-dom';
import './legal.css';

function BackArrow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
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

export default function HelpSupportPage() {
  return (
    <main className="legal-page">
      <div className="legal-card legal-card--pad-top">
        <header className="legal-top">
          <Link to="/profile" className="legal-back" aria-label="Back to profile">
            <BackArrow />
          </Link>
          <h1 className="legal-top__title">Help &amp; Support</h1>
          <span className="legal-top__spacer" aria-hidden />
        </header>

        <p className="legal-lead">
          Need something? Start here — we&apos;ll point you to the right place.
        </p>

        <section className="legal-section">
          <h2>Orders &amp; deliveries</h2>
          <p>
            Track active deliveries from your order screen. If something looks wrong (wrong address,
            delayed rider), contact us using the options below and include your order reference if
            you have one.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact us</h2>
          <p>
            <strong>Email:</strong>{' '}
            <a href="mailto:admin@ingo.co.zw" className="legal-inline-link">
              admin@ingo.co.zw
            </a>
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            <strong>Phone number:</strong>{' '}
            <a href="tel:0789701394" className="legal-inline-link">
              0789701394
            </a>
          </p>
        </section>

        <section className="legal-section">
          <h2>Quick links</h2>
          <ul className="legal-bullets">
            <li>
              <Link to="/faqs" className="legal-inline-link">
                Frequently asked questions
              </Link>
            </li>
            <li>
              <Link to="/terms" className="legal-inline-link">
                Terms &amp; conditions
              </Link>
            </li>
            <li>
              <Link to="/privacy-policy" className="legal-inline-link">
                Privacy policy
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
