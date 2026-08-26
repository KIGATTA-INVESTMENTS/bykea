import './GoogleMapEmbed.css';

/**
 * Renders a Maps embed iframe when `src` is non-empty.
 * Prefer passing a legacy `output=embed` URL on the driver portal so maps still
 * show when Maps Embed API / referrers block the keyed iframe.
 * Avoid remounting the iframe unless `src` actually changes (GPS jitter must not force a reload).
 */
export default function GoogleMapEmbed({ src, title = 'Map', loading = 'eager', lockInteractions = false }) {
  const url = typeof src === 'string' ? src.trim() : '';
  if (!url) {
    return (
      <div className="gmap-embed-wrap gmap-embed-wrap--empty" aria-hidden>
        <div className="gmap-embed-empty" />
      </div>
    );
  }
  return (
    <div className={lockInteractions ? 'gmap-embed-wrap gmap-embed-wrap--locked' : 'gmap-embed-wrap'}>
      <iframe
        className="gmap-embed-frame"
        title={title}
        src={url}
        loading={loading}
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
