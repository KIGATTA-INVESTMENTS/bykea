import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import ShopOrderTrackingSteps from '../components/ShopOrderTrackingSteps';
import { mapDriverRegistrationRow } from '../lib/customerOrderFeed';
import { formatGBP } from '../lib/currency';
import { isReliableGpsLatLng, publicDirectionsCoordsMapUrl, publicDirectionsMapUrl, publicPlaceMapUrl } from '../lib/googleMapsConfig';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { notifyDriversOfNewOffer, notifyDriversOfOfferStop } from '../lib/driverOfferPushNotify';
import { getShopOwnerSession } from '../lib/shopOwnerAuth';
import { normalizeShopOrderStatus, shopOwnerNextAction, shopOwnerOrderStatusLabel } from '../lib/shopOrderStatus';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './shopOwnerPortal.css';
import './shopOwnerOrdersPremium.css';
import './orderTracking.css';
import './customerAccount.css';

const ADVANCED_STATUS_OPTIONS = [
  { db: 'processing', label: 'Preparing' },
  { db: 'ready for delivery', label: 'Ready for pickup' },
  { db: 'picked up', label: 'Picked up' },
  { db: 'in transit', label: 'In transit' },
  { db: 'delivered', label: 'Delivered' },
];

function formatDt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function effectiveNavLeg(row) {
  const navLeg = String(row?.driver_nav_leg || '')
    .toLowerCase()
    .trim();
  if (navLeg === 'to_dropoff' || navLeg === 'to_pickup') return navLeg;
  const s = normalizeShopOrderStatus(row?.status);
  if (s === 'picked up' || s === 'in transit') return 'to_dropoff';
  if (s === 'ready for delivery' && row?.assigned_driver_id) return 'to_pickup';
  return 'to_pickup';
}

function shopOwnerTrackingHeadline(row, hasDriver) {
  const s = normalizeShopOrderStatus(row?.status);
  if (s === 'cancelled') return 'This order was cancelled.';
  if (s === 'delivered') return 'Order delivered to the customer.';
  if (s === 'placed') return 'Confirm this order to accept it and start preparing.';
  if (s === 'processing') return 'Prepare the items, then mark ready for pickup when packed.';
  if (!hasDriver) {
    if (['ready for delivery', 'picked up', 'in transit'].includes(s)) {
      return 'Waiting for a driver to accept this delivery.';
    }
    return 'Confirm and prepare the order, then mark it ready for a driver.';
  }
  const navLeg = effectiveNavLeg(row);
  if (navLeg === 'to_dropoff' || s === 'picked up' || s === 'in transit') {
    return 'Courier is on the way to the customer with your order.';
  }
  return 'Courier is heading to your shop for pickup.';
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
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

export default function ShopOwnerOrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const orderDbId = orderId ? decodeURIComponent(orderId) : '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [orderRow, setOrderRow] = useState(null);
  const [myLines, setMyLines] = useState([]);
  const [pickupAddr, setPickupAddr] = useState('');
  const [driverRow, setDriverRow] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const [fromGeo, setFromGeo] = useState(null);
  const [toGeo, setToGeo] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState('');
  const [showAdvancedStatus, setShowAdvancedStatus] = useState(false);

  const dropAddr = useMemo(() => String(orderRow?.customer_address || '').trim(), [orderRow?.customer_address]);
  const hasDriver = Boolean(orderRow?.assigned_driver_id && driverRow);
  const driverUi = driverRow ? mapDriverRegistrationRow(driverRow) : null;
  const statusRaw = normalizeShopOrderStatus(orderRow?.status);
  const amountNum = useMemo(
    () => myLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0),
    [myLines],
  );

  const fetchSnapshot = useCallback(async () => {
    const session = getShopOwnerSession();
    if (!session?.id || !orderDbId || !isSupabaseConfigured || !supabase) return;

    const { data: lines, error: lErr } = await supabase
      .from('shop_customer_order_lines')
      .select('*')
      .eq('order_id', orderDbId)
      .eq('shop_owner_id', session.id);

    if (lErr) throw new Error(lErr.message);
    if (!lines?.length) {
      setLoadError('This order was not found for your shop.');
      setOrderRow(null);
      setMyLines([]);
      return;
    }

    const { data: ord, error: oErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .eq('id', orderDbId)
      .maybeSingle();

    if (oErr) throw new Error(oErr.message);
    if (!ord) {
      setLoadError('Order not found.');
      setOrderRow(null);
      setMyLines([]);
      return;
    }

    setOrderRow(ord);
    setMyLines(lines);
    setLoadError('');

    const { data: shopRow } = await supabase
      .from('shop_owners')
      .select('business_address, business_name')
      .eq('id', session.id)
      .maybeSingle();

    const shopName = String(shopRow?.business_name || session.business_name || 'Your shop').trim();
    const shopAddress = String(shopRow?.business_address || '').trim();
    setPickupAddr(shopAddress ? `${shopAddress}${shopName ? ` (${shopName})` : ''}` : shopName);

    const aid = ord.assigned_driver_id;
    if (aid) {
      const { data: d, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
        .eq('id', aid)
        .maybeSingle();
      if (!dErr && d) setDriverRow(d);
      else setDriverRow(null);
    } else {
      setDriverRow(null);
    }
  }, [orderDbId]);

  useEffect(() => {
    let cancelled = false;
    if (!orderDbId) {
      setLoading(false);
      setLoadError('Missing order.');
      return undefined;
    }

    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        await fetchSnapshot();
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'Could not load order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderDbId, fetchSnapshot]);

  useEffect(() => {
    if (!orderDbId) return undefined;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setPollTick((n) => n + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, [orderDbId]);

  useEffect(() => {
    if (!orderDbId || pollTick === 0) return;
    fetchSnapshot().catch(() => {});
  }, [pollTick, orderDbId, fetchSnapshot]);

  useEffect(() => {
    let cancelled = false;
    if (!pickupAddr || !dropAddr) {
      setFromGeo(null);
      setToGeo(null);
      return undefined;
    }
    (async () => {
      try {
        const [fg, tg] = await Promise.all([forwardGeocodeAddress(pickupAddr), forwardGeocodeAddress(dropAddr)]);
        if (cancelled) return;
        setFromGeo(fg && Number.isFinite(fg.lat) && Number.isFinite(fg.lng) ? fg : null);
        setToGeo(tg && Number.isFinite(tg.lat) && Number.isFinite(tg.lng) ? tg : null);
      } catch {
        if (!cancelled) {
          setFromGeo(null);
          setToGeo(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickupAddr, dropAddr]);

  const trackingMapSrc = useMemo(() => {
    if (!pickupAddr || !dropAddr) return '';
    const drvLat = Number(orderRow?.driver_live_lat);
    const drvLng = Number(orderRow?.driver_live_lng);
    const navLeg = effectiveNavLeg(orderRow);
    const mapDest = navLeg === 'to_dropoff' ? toGeo : fromGeo;
    if (isReliableGpsLatLng(drvLat, drvLng) && mapDest?.lat != null && mapDest?.lng != null) {
      const liveDriverRoute = publicDirectionsCoordsMapUrl(drvLat, drvLng, mapDest.lat, mapDest.lng);
      if (liveDriverRoute) return liveDriverRoute;
    }
    if (!hasDriver && fromGeo && toGeo) {
      const fullRoute = publicDirectionsCoordsMapUrl(fromGeo.lat, fromGeo.lng, toGeo.lat, toGeo.lng);
      if (fullRoute) return fullRoute;
    }
    if (hasDriver && navLeg === 'to_pickup') {
      return publicPlaceMapUrl(pickupAddr) || publicDirectionsMapUrl(pickupAddr, dropAddr);
    }
    if (fromGeo && toGeo) {
      const c = publicDirectionsCoordsMapUrl(fromGeo.lat, fromGeo.lng, toGeo.lat, toGeo.lng);
      if (c) return c;
    }
    return publicDirectionsMapUrl(pickupAddr, dropAddr);
  }, [pickupAddr, dropAddr, fromGeo, toGeo, hasDriver, orderRow]);

  const headline = shopOwnerTrackingHeadline(orderRow, hasDriver);
  const nextAction = shopOwnerNextAction(statusRaw);
  const statusLabel = shopOwnerOrderStatusLabel(statusRaw);

  const soleSellerForOrder = async () => {
    if (!supabase || !orderDbId) return false;
    const sid = getShopOwnerSession()?.id;
    if (!sid) return false;
    const { data: all } = await supabase.from('shop_customer_order_lines').select('shop_owner_id').eq('order_id', orderDbId);
    if (!all?.length) return false;
    return all.every((l) => l.shop_owner_id === sid);
  };

  const updateFulfillmentStatus = async (nextDb) => {
    if (!orderRow || !supabase || !nextDb || statusRaw === nextDb) return;
    setStatusErr('');
    setStatusBusy(true);
    try {
      const ok = await soleSellerForOrder();
      if (!ok) {
        setStatusErr('This order includes other shops. Only an admin can change status for the whole order.');
        return;
      }
      const { error } = await supabase.from('shop_customer_orders').update({ status: nextDb }).eq('id', orderDbId);
      if (error) {
        setStatusErr(error.message);
        return;
      }
      if (String(nextDb).toLowerCase().trim() === 'ready for delivery') {
        notifyDriversOfNewOffer('shop_customer_orders', orderDbId);
      }
      await fetchSnapshot();
    } catch {
      setStatusErr('Could not update status. Try again.');
    } finally {
      setStatusBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!orderRow || !supabase) return;
    setCancelErr('');
    setCancelBusy(true);
    try {
      const ok = await soleSellerForOrder();
      if (!ok) {
        setCancelErr('This order includes other shops. Only an admin can cancel the whole order.');
        return;
      }
      const { error } = await supabase.from('shop_customer_orders').update({ status: 'cancelled' }).eq('id', orderDbId);
      if (error) {
        setCancelErr(error.message);
        return;
      }
      notifyDriversOfOfferStop('shop_customer_orders', orderDbId);
      await fetchSnapshot();
    } catch {
      setCancelErr('Could not cancel. Try again.');
    } finally {
      setCancelBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="soo-detail">
        <p className="soo-detail-loading">Loading order…</p>
      </div>
    );
  }

  if (loadError || !orderRow) {
    return (
      <div className="soo-detail">
        <button type="button" className="soo-detail-back" onClick={() => navigate('/shop-owner/orders')}>
          <BackIcon />
          Back to orders
        </button>
        <p className="soo-error" role="alert">
          {loadError || 'Order not found.'}
        </p>
      </div>
    );
  }

  return (
    <div className="soo-detail">
      <div className="soo-detail-head">
        <button type="button" className="soo-detail-back" onClick={() => navigate('/shop-owner/orders')} aria-label="Back to orders">
          <BackIcon />
        </button>
        <div>
          <h1>{orderRow.order_number || 'Order'}</h1>
          <p className="soo-detail-date">{formatDt(orderRow.placed_at)}</p>
        </div>
        <span className={`soo-detail-badge soo-detail-badge--${statusRaw.replace(/\s+/g, '-')}`}>{statusLabel}</span>
      </div>

      {nextAction ? (
        <section
          className={`soo-nextStep${statusRaw === 'placed' ? ' soo-nextStep--urgent' : ''}`}
          aria-label="What to do next"
        >
          <p className="soo-nextStep__kicker">What to do next</p>
          <h2 className="soo-nextStep__title">{nextAction.title}</h2>
          <p className="soo-nextStep__hint">{nextAction.hint}</p>
          {nextAction.buttonLabel && nextAction.nextStatus ? (
            <button
              type="button"
              className="soo-nextStep__btn"
              disabled={statusBusy}
              onClick={() => updateFulfillmentStatus(nextAction.nextStatus)}
            >
              {statusBusy ? 'Updating…' : nextAction.buttonLabel}
            </button>
          ) : null}
          {statusErr ? (
            <p role="alert" className="soo-nextStep__err">
              {statusErr}
            </p>
          ) : null}
          {statusRaw !== 'cancelled' && statusRaw !== 'delivered' ? (
            <button
              type="button"
              className="soo-nextStep__cancel"
              disabled={cancelBusy || statusBusy}
              onClick={cancelOrder}
            >
              {cancelBusy ? 'Cancelling…' : 'Cancel order'}
            </button>
          ) : null}
          {cancelErr ? (
            <p role="alert" className="soo-nextStep__err">
              {cancelErr}
            </p>
          ) : null}
        </section>
      ) : null}

      <p
        className={`soo-detail-status${hasDriver ? ' soo-detail-status--live' : ''}`}
        role="status"
        aria-live="polite"
      >
        {headline}
      </p>

      <section className="soo-detail-card">
        <h2>Customer</h2>
        <p style={{ margin: 0, fontWeight: 700 }}>{orderRow.customer_full_name}</p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#555' }}>{orderRow.customer_phone}</p>
        {orderRow.customer_email ? (
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.85rem', color: '#555' }}>{orderRow.customer_email}</p>
        ) : null}
        {orderRow.customer_notes ? (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
            <strong>Notes:</strong> {orderRow.customer_notes}
          </p>
        ) : null}
      </section>

      <section className="soo-detail-card">
        <h2>Items (your shop)</h2>
        <ul className="soo-detail-items">
          {myLines.map((l) => (
            <li key={l.id}>
              {l.product_name} ×{l.quantity} — {formatGBP(Number(l.line_total) || 0)}
            </li>
          ))}
        </ul>
        <p className="soo-detail-total">
          Your total: <strong>{formatGBP(amountNum)}</strong>
        </p>
      </section>

      <div className="soo-detail-map-wrap">
        <div className={`lt-map-card lt-map-card--gmap${trackingMapSrc ? '' : ' lt-map-card--placeholder'}`}>
          <GoogleMapEmbed src={trackingMapSrc} title="Order tracking map" loading="eager" />
        </div>
        {hasDriver ? (
          <span className="soo-detail-live-pill" role="status">
            <span className="soo-detail-live-dot" aria-hidden />
            Live courier tracking
          </span>
        ) : null}
      </div>

      <div className="soo-detail-route" aria-label="Route">
        <p>
          <span className="soo-detail-route-dot soo-detail-route-dot--pickup" aria-hidden />
          <span>
            <strong>Pickup</strong> {pickupAddr || 'Your shop'}
          </span>
        </p>
        <p>
          <span className="soo-detail-route-dot soo-detail-route-dot--drop" aria-hidden />
          <span>
            <strong>Delivery</strong> {dropAddr}
          </span>
        </p>
      </div>

      <section className="soo-detail-card" aria-label="Order progress">
        <h2>Order tracking</h2>
        <ShopOrderTrackingSteps status={orderRow.status} variant="od" />
      </section>

      {driverUi ? (
        <section className="soo-detail-card">
          <h2>Courier</h2>
          <p style={{ margin: 0, fontWeight: 700 }}>{driverUi.name}</p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#555' }}>{driverUi.phone}</p>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: '#666' }}>
            {driverUi.vehicle} · {driverUi.plate}
          </p>
        </section>
      ) : ['ready for delivery', 'picked up', 'in transit'].includes(statusRaw) ? (
        <section className="soo-detail-card">
          <h2>Courier</h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#555' }}>Waiting for a driver to accept this delivery.</p>
        </section>
      ) : null}

      {!['cancelled', 'delivered'].includes(statusRaw) ? (
        <section className="soo-detail-card">
          <button
            type="button"
            className="soo-advancedToggle"
            aria-expanded={showAdvancedStatus}
            onClick={() => setShowAdvancedStatus((v) => !v)}
          >
            {showAdvancedStatus ? 'Hide other status options' : 'Need a different status?'}
          </button>
          {showAdvancedStatus ? (
            <>
              <fieldset className="sopStatPick" disabled={statusBusy}>
                <legend className="sopStatPick__leg">Set status manually</legend>
                {ADVANCED_STATUS_OPTIONS.map(({ db, label }) => (
                  <label key={db} className="sopStatPick__row">
                    <input
                      type="radio"
                      name={`fulfill-detail-${orderDbId}`}
                      checked={statusRaw === db}
                      onChange={() => updateFulfillmentStatus(db)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              {statusBusy ? <p className="sopStatPick__hint">Updating…</p> : null}
            </>
          ) : null}
        </section>
      ) : null}

      <p className="soo-detail-foot">
        <Link to="/shop-owner/orders">← All orders</Link>
      </p>
    </div>
  );
}
