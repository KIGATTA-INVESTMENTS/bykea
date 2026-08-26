import './ServiceComingSoonBadge.css';

/** Pill badge for services not yet live on web. */
export default function ServiceComingSoonBadge({ className = '' }) {
  return (
    <span className={`svc-soon-badge${className ? ` ${className}` : ''}`} aria-label="Coming soon">
      <span className="svc-soon-badge__dot" aria-hidden />
      Coming Soon
    </span>
  );
}
