import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ShopOrderTrackingSteps from '../components/ShopOrderTrackingSteps';
import { getOrderById, statusLabel } from '../data/mockOrders';
import { fetchCustomerOrderDetail, mapDriverRegistrationRow, parseOrderNavKey } from '../lib/customerOrderFeed';
import { getCustomerSession } from '../lib/customerSession';
import { shopOrderCustomerBadgeKey, shopOrderProgressMessage, shopOrderStatusLabel } from '../lib/shopOrderStatus';
import './customerAccount.css';

function badgeClass(status) {
  if (status === 'delivered') return 'oh-badg oh-badg--d';
  if (status === 'transit') return 'oh-badg oh-badg--t';
  if (status === 'cancelled') return 'oh-badg oh-badg--c';
  if (status === 'active') return 'oh-badg oh-badg--a';
  return 'oh-badg oh-badg--a';
}

function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDetailDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function uiStatusDelivery(db) {
  const s = String(db || '').toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'delivered') return 'delivered';
  if (s === 'paid' || s === 'assigned') return 'transit';
  return 'active';
}

/** Customer-facing copy for live delivery rows (Supabase). */
function deliveryProgressMessage(row) {
  const st = String(row?.status || '')
    .toLowerCase()
    .trim();
  if (st === 'cancelled') return 'This delivery was cancelled.';
  if (st === 'delivered') return 'Your parcel has been delivered.';
  if (st === 'assigned' && row?.assigned_driver_id) {
    const leg = String(row?.driver_nav_leg || '')
      .toLowerCase()
      .trim();
    if (leg === 'to_dropoff') return 'Driver picked up your parcel and is on the way to the drop-off.';
    return 'Driver assigned — heading to the pickup.';
  }
  if (st === 'paid' || st === 'placed') return 'Waiting for a driver to accept your delivery.';
  return 'Your order is being processed.';
}

function uiStatusRide(db) {
  const s = String(db || '').toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'completed') return 'delivered';
  if (s === 'confirmed') return 'transit';
  return 'active';
}

function shortUuid(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

function taxiRideTypeLabel(row) {
  const rt = String(row?.ride_type || '').toLowerCase();
  if (rt === 'prem') return 'Premium';
  if (rt === 'tuk') return 'Tuk-Tuk';
  const vt = String(row?.vehicle_type || '').toLowerCase();
  if (vt === 'bicycle') return 'Bike';
  if (vt === 'tuktuk') return 'Tuk-Tuk';
  if (vt === 'car') return 'Car';
  if (vt === 'minibus') return 'Mini Bus';
  if (rt === 'std') return 'Standard';
  return row?.ride_type || '—';
}

function liveOrderFromBundle(bundle) {
  if (!bundle) return null;
  const { kind, row, lines } = bundle;

  if (kind === 'delivery') {
    return {
      source: 'live',
      kind: 'delivery',
      titleId: `Parcel · ${shortUuid(row.id)}`,
      status: uiStatusDelivery(row.status),
      from: row.pickup_location || '—',
      to: row.dropoff_location || '—',
      date: formatDetailDate(row.created_at),
      breakdown: {
        base: Number(row.base_fare_amount) || 0,
        distance: Number(row.distance_fee_amount) || 0,
        service: Number(row.service_fee_amount) || 0,
        total: Number(row.total_amount) || 0,
      },
      driver: bundle.driver ? mapDriverRegistrationRow(bundle.driver) : null,
      rated: true,
      meta: {
        payment: row.payment_method,
        packageSize: row.package_size,
        packageWeight: row.package_weight,
        deliveryType: row.delivery_type,
        deliveryProgress: deliveryProgressMessage(row),
      },
    };
  }

  if (kind === 'taxi') {
    const q = Number(row.quoted_price);
    const total = Number.isFinite(q) ? q : 0;
    return {
      source: 'live',
      kind: 'taxi',
      titleId: `Taxi · ${shortUuid(row.id)}`,
      status: uiStatusRide(row.status),
      from: row.pickup_location || '—',
      to: row.destination_location || '—',
      date: formatDetailDate(row.created_at),
      breakdown: { base: total, distance: 0, service: 0, total },
      driver: bundle.driver ? mapDriverRegistrationRow(bundle.driver) : null,
      rated: true,
      meta: {
        rideType: taxiRideTypeLabel(row),
        estDist: row.estimated_distance_label,
        estDur: row.estimated_duration_label,
      },
    };
  }

  if (kind === 'tuk') {
    const q = Number(row.quoted_price);
    const total = Number.isFinite(q) ? q : 0;
    return {
      source: 'live',
      kind: 'tuk',
      titleId: `Tuk-tuk · ${shortUuid(row.id)}`,
      status: uiStatusRide(row.status),
      from: row.pickup_location || '—',
      to: row.destination_location || '—',
      date: formatDetailDate(row.created_at),
      breakdown: { base: total, distance: 0, service: 0, total },
      driver: bundle.driver ? mapDriverRegistrationRow(bundle.driver) : null,
      rated: true,
      meta: {
        estDist: row.estimated_distance_label,
        estDur: row.estimated_duration_label,
      },
    };
  }

  if (kind === 'shop') {
    const sub = Number(row.subtotal) || 0;
    const del = Number(row.delivery_fee) || 0;
    const hasDriver = Boolean(row.assigned_driver_id);
    return {
      source: 'live',
      kind: 'shop',
      titleId: row.order_number || `Shop · ${shortUuid(row.id)}`,
      status: shopOrderCustomerBadgeKey(row.status),
      from: 'Shop order',
      to: row.customer_address || '—',
      date: formatDetailDate(row.placed_at),
      breakdown: { base: sub, distance: del, service: 0, total: sub + del },
      driver: bundle.driver ? mapDriverRegistrationRow(bundle.driver) : null,
      rated: true,
      meta: {
        customerName: row.customer_full_name,
        notes: row.customer_notes,
        shopStatusLabel: shopOrderStatusLabel(row.status),
        shopStatusRaw: row.status,
        shopProgress: shopOrderProgressMessage(row.status, { hasDriver }),
        shopHasDriver: hasDriver,
      },
      shopLines: lines || [],
    };
  }

  return null;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden>
      <path
        d="M15.5 19.5L8 12l7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OrderDetailsPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const raw = orderId ? decodeURIComponent(orderId) : '';

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [liveBundle, setLiveBundle] = useState(null);

  const mockOrder = useMemo(() => {
    if (!raw || parseOrderNavKey(raw)) return null;
    return getOrderById(raw);
  }, [raw]);

  useEffect(() => {
    let cancelled = false;
    const parsed = parseOrderNavKey(raw);

    if (!raw) {
      setLoading(false);
      setLiveBundle(null);
      setFetchError('');
      return () => {
        cancelled = true;
      };
    }

    if (!parsed) {
      setLoading(false);
      setLiveBundle(null);
      setFetchError('');
      return () => {
        cancelled = true;
      };
    }

    const loadDetail = async (isInitial = false) => {
      const session = getCustomerSession();
      const { data, error } = await fetchCustomerOrderDetail(raw, session);
      if (cancelled) return;
      if (error) {
        if (isInitial) setFetchError(error);
        return;
      }
      setLiveBundle(data);
      if (isInitial) setFetchError('');
    };

    setLoading(true);
    setFetchError('');
    setLiveBundle(null);

    (async () => {
      await loadDetail(true);
      if (!cancelled) setLoading(false);
    })();

    const pollMs = parsed.kind === 'shop' ? 3000 : 0;
    const timer = pollMs ? window.setInterval(() => loadDetail(false), pollMs) : null;

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [raw]);

  const order = useMemo(() => {
    if (parseOrderNavKey(raw)) {
      return liveOrderFromBundle(liveBundle);
    }
    return mockOrder;
  }, [raw, liveBundle, mockOrder]);

  if (!raw) {
    return (
      <div className="od-page">
        <header className="od-h">
          <button type="button" className="od-back" onClick={() => navigate('/orders')} aria-label="Back">
            <BackIcon />
          </button>
          <h1>Order</h1>
        </header>
        <div className="od-scroll" style={{ padding: '1rem' }}>
          <p style={{ textAlign: 'center', color: '#555' }}>Missing order.</p>
        </div>
      </div>
    );
  }

  if (parseOrderNavKey(raw)) {
    if (loading) {
      return (
        <div className="od-page">
          <header className="od-h">
            <button type="button" className="od-back" onClick={() => navigate('/orders')} aria-label="Back to orders">
              <BackIcon />
            </button>
            <h1>Order</h1>
          </header>
          <div className="od-scroll" style={{ padding: '1rem' }}>
            <p style={{ textAlign: 'center', color: '#555' }}>Loading…</p>
          </div>
        </div>
      );
    }
    if (fetchError || !order) {
      return (
        <div className="od-page">
          <header className="od-h">
            <button type="button" className="od-back" onClick={() => navigate(-1)} aria-label="Back">
              <BackIcon />
            </button>
            <h1>Order</h1>
          </header>
          <div className="od-scroll" style={{ padding: '1rem' }}>
            <p style={{ textAlign: 'center', color: '#555' }} role="alert">
              {fetchError || 'This order was not found.'}
            </p>
            <button
              type="button"
              className="od-link"
              style={{ background: 'none', border: 0, cursor: 'pointer', width: '100%' }}
              onClick={() => navigate('/orders')}
            >
              Return to My Orders
            </button>
          </div>
        </div>
      );
    }
  } else if (!mockOrder) {
    return (
      <div className="od-page">
        <header className="od-h">
          <button type="button" className="od-back" onClick={() => navigate(-1)} aria-label="Back">
            <BackIcon />
          </button>
          <h1>Order</h1>
        </header>
        <div className="od-scroll" style={{ padding: '1rem' }}>
          <p style={{ textAlign: 'center', color: '#555' }}>This order was not found.</p>
          <button
            type="button"
            className="od-link"
            style={{ background: 'none', border: 0, cursor: 'pointer', width: '100%' }}
            onClick={() => navigate('/orders')}
          >
            Return to My Orders
          </button>
        </div>
      </div>
    );
  }

  const { base, distance, service, total } = order.breakdown;
  const showRate = order.rated === false && order.status === 'delivered' && !parseOrderNavKey(raw);
  const isShop = order.kind === 'shop';

  return (
    <div className="od-page">
      <header className="od-h">
        <button type="button" className="od-back" onClick={() => navigate('/orders')} aria-label="Back to orders">
          <BackIcon />
        </button>
        <h1>Order {order.titleId || order.id}</h1>
      </header>
      <div className="od-scroll">
        <div className="od-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, border: 0, padding: 0 }}>Status</h2>
            <span className={badgeClass(order.status)} style={{ fontSize: '0.7rem' }}>
              {isShop && order.meta?.shopStatusLabel ? order.meta.shopStatusLabel : statusLabel(order.status)}
            </span>
          </div>
          {order.kind === 'delivery' && order.source === 'live' && order.meta?.deliveryProgress ? (
            <p
              className="od-deliveryStatusMsg"
              style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.45, color: '#2a2a2a', fontWeight: 650 }}
              role="status"
            >
              {order.meta.deliveryProgress}
            </p>
          ) : null}
          {order.kind === 'shop' && order.source === 'live' && order.meta?.shopProgress ? (
            <p
              className="od-deliveryStatusMsg"
              style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.45, color: '#2a2a2a', fontWeight: 650 }}
              role="status"
            >
              {order.meta.shopProgress}
            </p>
          ) : null}
        </div>

        {isShop && order.source === 'live' && order.meta?.shopStatusRaw ? (
          <div className="od-card">
            <h2>Order tracking</h2>
            <ShopOrderTrackingSteps status={order.meta.shopStatusRaw} variant="od" />
          </div>
        ) : null}

        <div className="od-card">
          <h2>Route</h2>
          <p style={{ margin: '0.2rem 0 0.15rem' }}>
            <strong>From</strong> {order.from}
          </p>
          <p style={{ margin: 0 }}>
            <strong>To</strong> {order.to}
          </p>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', color: '#666' }}>{order.date}</p>
        </div>

        {order.meta?.customerName ? (
          <div className="od-card">
            <h2>Customer</h2>
            <p style={{ margin: 0 }}>{order.meta.customerName}</p>
            {order.meta.notes ? (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: '#555' }}>Notes: {order.meta.notes}</p>
            ) : null}
          </div>
        ) : null}

        {(order.kind === 'taxi' || order.kind === 'tuk') && order.meta ? (
          <div className="od-card">
            <h2>Ride details</h2>
            {order.kind === 'taxi' && order.meta.rideType ? (
              <p style={{ margin: '0.15rem 0' }}>
                <strong>Type</strong> {order.meta.rideType}
              </p>
            ) : null}
            {order.meta.estDist ? (
              <p style={{ margin: '0.15rem 0' }}>
                <strong>Est. distance</strong> {order.meta.estDist}
              </p>
            ) : null}
            {order.meta.estDur ? (
              <p style={{ margin: '0.15rem 0' }}>
                <strong>Est. duration</strong> {order.meta.estDur}
              </p>
            ) : null}
          </div>
        ) : null}

        {order.kind === 'delivery' && order.meta?.payment ? (
          <div className="od-card">
            <h2>Delivery</h2>
            <p style={{ margin: '0.15rem 0' }}>
              <strong>Payment</strong> {order.meta.payment}
            </p>
            {order.meta.deliveryType ? (
              <p style={{ margin: '0.15rem 0' }}>
                <strong>Speed</strong> {order.meta.deliveryType}
              </p>
            ) : null}
            {order.meta.packageSize || order.meta.packageWeight ? (
              <p style={{ margin: '0.15rem 0' }}>
                <strong>Package</strong>{' '}
                {[order.meta.packageSize, order.meta.packageWeight].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
        ) : null}

        {order.driver ? (
          <div className="od-card">
            <h2>{isShop ? 'Delivery driver' : 'Your driver'}</h2>
            <div className="od-drv" style={{ marginTop: 4 }}>
              <div className="od-av" aria-hidden />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{order.driver.name}</div>
                <div style={{ fontSize: '0.82rem', color: '#555' }}>{order.driver.phone}</div>
                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: 2 }}>
                  {order.driver.vehicle} · {order.driver.plate}
                </div>
                {/\d/.test(String(order.driver.phone || '')) ? (
                  <a
                    href={`tel:${String(order.driver.phone).replace(/[^\d+]/g, '')}`}
                    style={{
                      display: 'inline-block',
                      marginTop: '0.45rem',
                      fontWeight: 700,
                      color: '#166534',
                      fontSize: '0.85rem',
                    }}
                  >
                    Call driver
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {isShop && order.source === 'live' && !order.driver && order.meta?.shopHasDriver === false ? (
          <div className="od-card">
            <h2>Delivery driver</h2>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#555', lineHeight: 1.45 }}>
              {['ready for delivery', 'picked up', 'in transit'].includes(
                String(order.meta?.shopStatusRaw || '')
                  .toLowerCase()
                  .trim(),
              )
                ? 'Waiting for a driver to accept your shop delivery. Details will appear here once assigned.'
                : 'A driver will be assigned when your order is ready for delivery.'}
            </p>
          </div>
        ) : null}

        {isShop && order.shopLines?.length > 0 ? (
          <div className="od-card">
            <h2>Items</h2>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {order.shopLines.map((line) => (
                <li key={line.id} style={{ marginBottom: '0.45rem' }}>
                  <span style={{ fontWeight: 600 }}>
                    {line.quantity}× {line.product_name}
                  </span>
                  {line.shop_name ? (
                    <span style={{ fontSize: '0.8rem', color: '#666', display: 'block' }}>{line.shop_name}</span>
                  ) : null}
                  <span style={{ fontSize: '0.85rem', color: '#333' }}>{formatMoney(Number(line.line_total) || 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="od-card">
          <h2>{isShop && order.shopLines?.length > 0 ? 'Totals' : 'Price breakdown'}</h2>
          {order.kind === 'shop' ? (
            <>
              <div className="od-rowB">
                <span>Subtotal</span>
                <span>{formatMoney(base)}</span>
              </div>
              <div className="od-rowB">
                <span>Delivery</span>
                <span>{formatMoney(distance)}</span>
              </div>
              <div className="od-total">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </>
          ) : order.kind === 'taxi' || order.kind === 'tuk' ? (
            <>
              <div className="od-rowB">
                <span>Quoted fare</span>
                <span>{formatMoney(base)}</span>
              </div>
              <div className="od-total">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="od-rowB">
                <span>Base fare</span>
                <span>{formatMoney(base)}</span>
              </div>
              <div className="od-rowB">
                <span>Distance</span>
                <span>{formatMoney(distance)}</span>
              </div>
              <div className="od-rowB">
                <span>Service &amp; fees</span>
                <span>{formatMoney(service)}</span>
              </div>
              <div className="od-total">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </>
          )}
        </div>

        {showRate && (
          <button type="button" className="od-btn" onClick={() => navigate('/rate', { state: { order } })}>
            Rate this delivery
          </button>
        )}
      </div>
    </div>
  );
}
