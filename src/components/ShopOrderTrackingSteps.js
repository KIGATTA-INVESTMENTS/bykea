import {
  SHOP_ORDER_TRACKING_STEPS,
  normalizeShopOrderStatus,
  shopOrderStepIndex,
} from '../lib/shopOrderStatus';

/**
 * Vertical fulfillment tracker for shop orders (customer app).
 * @param {{ status: string, variant?: 'ty' | 'od' }} props
 */
export default function ShopOrderTrackingSteps({ status, variant = 'ty' }) {
  const root = variant === 'od' ? 'od-track' : 'ty-track';
  const st = normalizeShopOrderStatus(status);
  const si = shopOrderStepIndex(status);

  if (st === 'cancelled') {
    return (
      <p className={`${root}__cancelled`} role="status">
        This order was cancelled.
      </p>
    );
  }

  const allDone = st === 'delivered';

  return (
    <div className={root} role="list" aria-label="Order progress">
      {SHOP_ORDER_TRACKING_STEPS.map((label, i) => {
        const done = allDone || i < si;
        const current = !allDone && i === si;
        const dotClass = done
          ? `${root}__dot ${root}__dot--done`
          : current
            ? `${root}__dot ${root}__dot--current`
            : `${root}__dot`;
        const labelClass =
          done || current ? `${root}__label ${root}__label--active` : `${root}__label`;
        return (
          <div key={label} className={`${root}__step`} role="listitem">
            <span className={dotClass} aria-hidden>
              {done ? '✓' : '○'}
            </span>
            <span className={labelClass}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
