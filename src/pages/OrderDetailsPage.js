import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ShopOrderTrackingSteps from '../components/ShopOrderTrackingSteps';
import { getOrderById, statusLabel } from '../data/mockOrders';
import { fetchCustomerOrderDetail, mapDriverRegistrationRow, parseOrderNavKey } from '../lib/customerOrderFeed';
import { getCustomerSession } from '../lib/customerSession';
import { sweepAutoCancelStaleBookings, cancelCustomerBooking, canCustomerCancelBooking, CANCEL_REASON_CUSTOMER } from '../lib/customerOrderCancel';
import {
  isDriverSearchTimedOut,
  noDriverAvailableDetail,
  noDriverAvailableHeadline,
} from '../lib/driverSearchWait';
import { buildLiveTrackingStateFromDetail, isCustomerOrderTrackable } from '../lib/liveTrackingState';
import DeliveryPin from '../components/DeliveryPin';
import PackagePhotoCapture from '../components/PackagePhotoCapture';
import { DELIVERY_PIN_CUSTOMER_HINT, storedDeliveryPin } from '../lib/deliveryConfirmationCode';
import { isPackagePhotoSrc, persistParcelPackagePhoto } from '../lib/packagePhoto';
import { shopOrderCustomerBadgeKey, shopOrderProgressMessage, shopOrderStatusLabel } from '../lib/shopOrderStatus';
import ConfirmDialog from '../components/ConfirmDialog';
import '../components/ConfirmDialog.css';
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
function deliveryProgressMessage(row, timedOut = false) {
  const st = String(row?.status || '')
    .toLowerCase()
    .trim();
  if (st === 'cancelled') {
    const reason = String(row?.cancel_reason || '').trim();
    const by = String(row?.cancelled_by || '').toLowerCase();
    const who = by === 'driver' ? ' by the driver' : by === 'customer' ? ' by you' : '';
    if (reason) return `This delivery was cancelled${who} — ${reason}.`;
    return `This delivery was cancelled${who}.`;
  }
  if (st === 'delivered') return 'Your parcel has been delivered.';
  if (st === 'assigned' && row?.assigned_driver_id) {
    const leg = String(row?.driver_nav_leg || '')
      .toLowerCase()
      .trim();
    if (leg === 'to_dropoff') return 'Driver picked up your parcel and is on the way to the drop-off.';
    return 'Driver assigned — heading to the pickup.';
  }
  if ((st === 'paid' || st === 'placed') && timedOut) {
    return `${noDriverAvailableHeadline()}. ${noDriverAvailableDetail({ isRide: false })}`;
  }
  if (st === 'paid' || st === 'placed') return 'Waiting for a driver to accept your delivery.';
  return 'Your order is being processed.';
}

function rideProgressMessage(row, timedOut = false) {
  const st = String(row?.status || '').toLowerCase().trim();
  if (st === 'cancelled') {
    const reason = String(row?.cancel_reason || '').trim();
    const by = String(row?.cancelled_by || '').toLowerCase();
    const who = by === 'driver' ? ' by the driver' : by === 'customer' ? ' by you' : '';
    if (reason) return `This ride was cancelled${who} — ${reason}.`;
    return `This ride was cancelled${who}.`;
  }
  if (st === 'completed') return 'Ride completed.';
  if (row?.assigned_driver_id) return 'Driver assigned — heading to pickup.';
  if (timedOut) return `${noDriverAvailableHeadline()}. ${noDriverAvailableDetail({ isRide: true })}`;
  return 'Waiting for a driver to accept your ride.';
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

function liveOrderFromBundle(bundle, driverSearchTimedOut = false) {
  if (!bundle) return null;
  const { kind, row, lines } = bundle;

  if (kind === 'delivery') {
    const code = storedDeliveryPin(row.delivery_confirmation_code);
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
        time: Number(row.time_fee_amount) || 0,
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
        deliveryProgress: deliveryProgressMessage(row, driverSearchTimedOut),
        cancelReason: row.cancel_reason?.trim() || null,
        cancelledBy: row.cancelled_by?.trim() || null,
        deliveryConfirmationCode: code || null,
        packagePhotoDataUrl: isPackagePhotoSrc(row.package_photo_data_url) ? row.package_photo_data_url : null,
        driverPackagePhotoDataUrl: isPackagePhotoSrc(row.driver_package_photo_data_url)
          ? row.driver_package_photo_data_url
          : null,
        supabaseOrderId: row.id,
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
        rideProgress: rideProgressMessage(row, driverSearchTimedOut),
        cancelReason: row.cancel_reason?.trim() || null,
        cancelledBy: row.cancelled_by?.trim() || null,
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
        rideProgress: rideProgressMessage(row, driverSearchTimedOut),
        cancelReason: row.cancel_reason?.trim() || null,
        cancelledBy: row.cancelled_by?.trim() || null,
      },
    };
  }

  if (kind === 'shop') {
    const sub = Number(row.subtotal) || 0;
    const del = Number(row.delivery_fee) || 0;
    const hasDriver = Boolean(row.assigned_driver_id);
    const code = storedDeliveryPin(row.delivery_confirmation_code);
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
        deliveryConfirmationCode: code || null,
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
  const [waitTick, setWaitTick] = useState(0);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState('');
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

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

    const pollMs = parsed.kind === 'shop' || parsed.kind === 'delivery' || parsed.kind === 'taxi' || parsed.kind === 'tuk' ? 3000 : 0;
    const timer = pollMs ? window.setInterval(() => loadDetail(false), pollMs) : null;

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [raw]);

  const trackableLive = isCustomerOrderTrackable(liveBundle);
  const liveTrackingState = useMemo(
    () => buildLiveTrackingStateFromDetail(liveBundle),
    [liveBundle],
  );

  const awaitingDriver =
    liveBundle?.row &&
    !liveBundle.row.assigned_driver_id &&
    !['cancelled', 'delivered', 'completed'].includes(String(liveBundle.row.status || '').toLowerCase());

  const driverSearchTimedOut = useMemo(
    () =>
      isDriverSearchTimedOut({
        liveRow: liveBundle?.row,
        hasDriver: Boolean(liveBundle?.row?.assigned_driver_id),
      }),
    [liveBundle, waitTick],
  );

  useEffect(() => {
    if (!awaitingDriver) return undefined;
    const id = window.setInterval(() => setWaitTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [awaitingDriver]);

  const parsedNav = parseOrderNavKey(raw);

  const canCancelOrder = useMemo(() => {
    if (!liveBundle?.row || !parsedNav) return false;
    if (!['delivery', 'taxi', 'tuk'].includes(parsedNav.kind)) return false;
    return canCustomerCancelBooking(liveBundle.row, parsedNav.kind);
  }, [liveBundle, parsedNav]);

  const onCancelOrder = () => {
    if (!parsedNav || !liveBundle?.row || cancelBusy) return;
    const session = getCustomerSession();
    if (!session?.id) return;
    setCancelErr('');
    setCancelConfirmOpen(true);
  };

  const confirmCancelOrder = async () => {
    if (!parsedNav || !liveBundle?.row || cancelBusy) return;
    const session = getCustomerSession();
    if (!session?.id) return;
    setCancelBusy(true);
    setCancelErr('');
    const result = await cancelCustomerBooking({
      kind: parsedNav.kind,
      id: parsedNav.id,
      appUserId: session.id,
      reason: CANCEL_REASON_CUSTOMER,
    });
    setCancelBusy(false);
    if (!result.ok) {
      setCancelErr(result.error || 'Could not cancel.');
      return;
    }
    setCancelConfirmOpen(false);
    const { data } = await fetchCustomerOrderDetail(raw, session);
    if (data) setLiveBundle(data);
  };

  const order = useMemo(() => {
    if (parseOrderNavKey(raw)) {
      return liveOrderFromBundle(liveBundle, driverSearchTimedOut);
    }
    return mockOrder;
  }, [raw, liveBundle, mockOrder, driverSearchTimedOut]);

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

  const { base, distance, time = 0, service, total } = order.breakdown;
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
          {(order.kind === 'taxi' || order.kind === 'tuk') &&
          order.source === 'live' &&
          order.meta?.rideProgress ? (
            <p
              className="od-deliveryStatusMsg"
              style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.45, color: '#2a2a2a', fontWeight: 650 }}
              role="status"
            >
              {order.meta.rideProgress}
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
          {order.source === 'live' && (order.meta?.cancelReason || order.status === 'cancelled') ? (
            <div className="od-cancelNotice" role="status">
              <p className="od-cancelNotice__title">
                {order.meta?.cancelledBy === 'driver'
                  ? 'Cancelled by driver'
                  : order.meta?.cancelledBy === 'customer'
                    ? 'Cancelled by you'
                    : 'Cancelled'}
              </p>
              {order.meta?.cancelReason ? (
                <p className="od-cancelNotice__reason">Reason: {order.meta.cancelReason}</p>
              ) : null}
            </div>
          ) : null}
          {order.source === 'live' &&
          order.meta?.deliveryConfirmationCode &&
          order.status !== 'delivered' &&
          order.status !== 'cancelled' ? (
            <div className="od-deliveryCode" aria-label="Delivery PIN">
              <p className="od-deliveryCode__label">Your delivery PIN</p>
              <DeliveryPin value={order.meta.deliveryConfirmationCode} readOnly ariaLabel="Your delivery PIN" />
              <p className="od-deliveryCode__hint">{DELIVERY_PIN_CUSTOMER_HINT}</p>
            </div>
          ) : null}
          {cancelErr ? (
            <p style={{ margin: 0, color: '#b42318', fontSize: '0.85rem' }} role="alert">
              {cancelErr}
            </p>
          ) : null}
          {canCancelOrder ? (
            <button type="button" className="od-cancelOrderBtn" disabled={cancelBusy} onClick={onCancelOrder}>
              {cancelBusy ? 'Cancelling…' : 'Cancel order'}
            </button>
          ) : null}
          {trackableLive && liveTrackingState ? (
            <button
              type="button"
              className="od-trackLiveBtn"
              onClick={() => navigate('/live-tracking', { state: liveTrackingState })}
            >
              Track live on map
            </button>
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
            {order.source === 'live' && order.meta?.supabaseOrderId ? (
              <div style={{ marginTop: '0.65rem' }}>
                <PackagePhotoCapture
                  value={order.meta.packagePhotoDataUrl || ''}
                  onChange={async (url, name) => {
                    setLiveBundle((prev) =>
                      prev?.row
                        ? {
                            ...prev,
                            row: {
                              ...prev.row,
                              package_photo_data_url: url,
                              package_photo_filename: name || prev.row.package_photo_filename,
                            },
                          }
                        : prev,
                    );
                    const saved = await persistParcelPackagePhoto('customer', order.meta.supabaseOrderId, url, name);
                    if (!saved.ok) setCancelErr(saved.error || 'Could not save package photo.');
                  }}
                  label="Your package photo"
                  hint="Take or upload a photo of the parcel. Your driver will see this at pickup."
                  disabled={order.status === 'delivered' || order.status === 'cancelled'}
                />
                {order.meta.driverPackagePhotoDataUrl ? (
                  <figure className="da-packagePhotoWrap" style={{ marginTop: '0.75rem' }}>
                    <figcaption className="da-packagePhotoCap">Driver photo at pickup</figcaption>
                    <img
                      className="da-packagePhotoImg"
                      src={order.meta.driverPackagePhotoDataUrl}
                      alt="Package photographed by driver"
                    />
                  </figure>
                ) : null}
              </div>
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
              {time > 0 ? (
                <div className="od-rowB">
                  <span>Time fee</span>
                  <span>{formatMoney(time)}</span>
                </div>
              ) : null}
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

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel this order?"
        message="You can place a new delivery or ride anytime. This cannot be undone."
        confirmLabel="Yes, cancel"
        cancelLabel="Keep order"
        busy={cancelBusy}
        onCancel={() => {
          if (!cancelBusy) setCancelConfirmOpen(false);
        }}
        onConfirm={confirmCancelOrder}
      />
    </div>
  );
}
