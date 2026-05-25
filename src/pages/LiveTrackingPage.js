import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import { mapDriverRegistrationRow } from '../lib/customerOrderFeed';
import { isReliableGpsLatLng, publicDirectionsCoordsMapUrl, publicDirectionsMapUrl, publicPlaceMapUrl } from '../lib/googleMapsConfig';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './orderTracking.css';

const TIMELINE_STEPS = [
  { id: 'confirmed', label: 'Order Confirmed' },
  { id: 'preparing', label: 'Preparing Your Order' },
  { id: 'delivery', label: 'Out for Delivery' },
  { id: 'delivered', label: 'Delivered' },
];

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

function MapStoreIcon() {
  return (
    <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#07408f" />
      <path
        d="M8 14h16v10H8V14Zm2-4h12l1 3H9l1-3Z"
        stroke="#fff"
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M11 14v-2h2v2M15 14v-2h2v2M19 14v-2h2v2" stroke="#fff" strokeWidth="1" />
    </svg>
  );
}

function MapRiderIcon() {
  return (
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#fff" stroke="#07408f" strokeWidth="2" />
      <circle cx="10" cy="22" r="2.5" fill="#07408f" />
      <circle cx="22" cy="22" r="2.5" fill="#07408f" />
      <path
        d="M10 12h4l1.5 3h6.5l-1 5H11l-1-8Z"
        fill="#07408f"
        stroke="#07408f"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MapHomeIcon() {
  return (
    <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#07408f" />
      <path d="M16 8l8 7v9H8V15l8-7Z" fill="#fff" />
      <rect x="13" y="18" width="6" height="6" rx="0.5" fill="#07408f" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        d="M6.5 4.5h3.2l1.2 3.5 2.2-1.2a11 11 0 0 0 4.8 4.8l-1.2-2.2 3.5-1.2v3.2a2 2 0 0 1-2 1.8A13.5 13.5 0 0 1 4.7 6.5a2 2 0 0 1 1.8-2Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChat2() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path
        d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 4V7a2 2 0 0 1 2-2Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatShortTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return null;
  }
}

function timelineUiActiveIndex(activeIndex) {
  if (activeIndex >= 4) return 4;
  if (activeIndex <= 0) return 0;
  if (activeIndex === 1) return 1;
  return 2;
}

function getTimelineStepState(i, activeIndex) {
  if (activeIndex >= 4) return 'done';
  const uiActive = Math.min(3, timelineUiActiveIndex(activeIndex));
  if (i < uiActive) return 'done';
  if (i === uiActive) return 'active';
  return 'pending';
}

function formatOrderId(v) {
  if (!v) return '#ING-00234';
  const s = String(v).replace(/^#+/, '');
  return s.startsWith('ING') ? `#${s}` : `#ING-${s}`;
}

function rideDestinationFromState(order) {
  const stops = order.stops;
  if (Array.isArray(stops) && stops.length) {
    const texts = stops.map((x) => (x?.value ?? '').trim()).filter(Boolean);
    if (texts.length) return texts[texts.length - 1];
  }
  return String(order.to || order.dropoff || '').trim();
}

export default function LiveTrackingPage() {
  const navigate = useNavigate();
  const { state: order = {} } = useLocation();

  const deliveryId = order.supabaseOrderId || null;
  const rideId = order.taxiBookingId || null;
  const rideTable = order.bookingStorageTable || 'taxi_bookings';
  const isDelivery = Boolean(deliveryId);
  const pollTarget = deliveryId || rideId || null;

  const [liveRow, setLiveRow] = useState(null);
  const [liveDriverRow, setLiveDriverRow] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const [pollErr, setPollErr] = useState('');
  const [fromGeo, setFromGeo] = useState(null);
  const [toGeo, setToGeo] = useState(null);

  const fromAddr = useMemo(() => {
    if (liveRow?.pickup_location) return String(liveRow.pickup_location).trim();
    if (!isDelivery && order.pickup) return String(order.pickup).trim();
    return String(order.from || order.pickup || '').trim() || 'London, UK';
  }, [liveRow, isDelivery, order.from, order.pickup]);

  const toAddr = useMemo(() => {
    if (liveRow?.dropoff_location) return String(liveRow.dropoff_location).trim();
    if (liveRow?.destination_location) return String(liveRow.destination_location).trim();
    if (!isDelivery) return rideDestinationFromState(order) || 'London, UK';
    return String(order.to || order.dropoff || '').trim() || 'London, UK';
  }, [liveRow, isDelivery, order]);

  const fetchSnapshot = useCallback(async () => {
    if (!pollTarget || !isSupabaseConfigured || !supabase) return;
    setPollErr('');
    try {
      if (isDelivery) {
        const { data: row, error } = await supabase.from('customer_delivery_orders').select('*').eq('id', pollTarget).maybeSingle();
        if (error) throw new Error(error.message);
        setLiveRow(row || null);
        if (row?.assigned_driver_id) {
          const { data: d, error: de } = await supabase
            .from('driver_registrations')
            .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
            .eq('id', row.assigned_driver_id)
            .maybeSingle();
          if (!de && d) setLiveDriverRow(d);
          else setLiveDriverRow(null);
        } else {
          setLiveDriverRow(null);
        }
        return;
      }

      const { data: row, error } = await supabase.from(rideTable).select('*').eq('id', pollTarget).maybeSingle();
      if (error) throw new Error(error.message);
      setLiveRow(row || null);
      if (row?.assigned_driver_id) {
        const { data: d, error: de } = await supabase
          .from('driver_registrations')
          .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
          .eq('id', row.assigned_driver_id)
          .maybeSingle();
        if (!de && d) setLiveDriverRow(d);
        else setLiveDriverRow(null);
      } else {
        setLiveDriverRow(null);
      }
    } catch (e) {
      setPollErr(e?.message || String(e));
    }
  }, [isDelivery, pollTarget, rideTable]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!pollTarget || !isSupabaseConfigured || !supabase) return undefined;
    const id = window.setInterval(() => {
      setPollTick((n) => n + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, [pollTarget]);

  useEffect(() => {
    if (!pollTarget || pollTick === 0) return;
    fetchSnapshot();
  }, [pollTick, pollTarget, fetchSnapshot]);

  useEffect(() => {
    let cancelled = false;
    if (!fromAddr || !toAddr) {
      setFromGeo(null);
      setToGeo(null);
      return undefined;
    }
    (async () => {
      try {
        const [fg, tg] = await Promise.all([forwardGeocodeAddress(fromAddr), forwardGeocodeAddress(toAddr)]);
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
  }, [fromAddr, toAddr]);

  const orderId = formatOrderId(order.orderId);
  const driverUi = liveDriverRow ? mapDriverRegistrationRow(liveDriverRow) : order.driver || null;

  const hasDriver = Boolean(driverUi);
  const etaDisplay = useMemo(() => {
    const raw = String(order.eta || '').trim();
    if (raw) return raw.replace(/^Est\.?\s*/i, '');
    return '20–25 min';
  }, [order.eta]);

  const orderDetailsTo = useMemo(() => {
    if (deliveryId) return `/order/${encodeURIComponent(`delivery:${deliveryId}`)}`;
    if (rideId) {
      const kind = order.mode === 'tuk' || String(rideTable).includes('tuk') ? 'tuk' : 'taxi';
      return `/order/${encodeURIComponent(`${kind}:${rideId}`)}`;
    }
    const bare = String(order.orderId || '').replace(/^#+/, '');
    if (bare) return `/order/${encodeURIComponent(bare)}`;
    return null;
  }, [deliveryId, rideId, order.mode, order.orderId, rideTable]);

  const driverRating = useMemo(() => {
    const r = order.driver?.rating ?? order.rating;
    const n = Number(r);
    return Number.isFinite(n) && n > 0 ? n.toFixed(1) : '4.8';
  }, [order.driver?.rating, order.rating]);

  const activeIndex = useMemo(() => {
    if (!pollTarget) return 2;
    if (!hasDriver) return 1;
    const st = String(liveRow?.status || '').toLowerCase();
    const navLeg = String(liveRow?.driver_nav_leg || '').toLowerCase();
    if (st === 'completed' || st === 'delivered') return 4;
    if (navLeg === 'to_dropoff') return 3;
    if (isDelivery && st === 'assigned') return 2;
    if (!isDelivery && st === 'confirmed') return 2;
    if (hasDriver) return 2;
    return 1;
  }, [pollTarget, hasDriver, liveRow, isDelivery]);

  const placedIso = liveRow?.created_at || order.placedAt;
  const stepTimes = useMemo(() => {
    const base = placedIso ? new Date(placedIso) : null;
    if (!base || Number.isNaN(+base)) {
      return ['12:30 PM', '12:33 PM', '12:40 PM', null];
    }
    const addMin = (m) => new Date(base.getTime() + m * 60000);
    return [
      formatShortTime(base),
      formatShortTime(addMin(3)),
      formatShortTime(addMin(10)),
      activeIndex >= 4 ? formatShortTime(liveRow?.updated_at || liveRow?.delivered_at) : null,
    ];
  }, [placedIso, activeIndex, liveRow?.updated_at, liveRow?.delivered_at]);

  const trackingMapSrc = useMemo(() => {
    if (!fromAddr || !toAddr) return '';
    const drvLat = Number(liveRow?.driver_live_lat);
    const drvLng = Number(liveRow?.driver_live_lng);
    const dbStatus = String(liveRow?.status || '').toLowerCase();
    const navLegRaw = String(liveRow?.driver_nav_leg || '').toLowerCase();
    const navLeg =
      navLegRaw === 'to_dropoff' || dbStatus === 'transit' || dbStatus === 'completed' ? 'to_dropoff' : 'to_pickup';
    const mapDest = navLeg === 'to_dropoff' ? toGeo : fromGeo;
    if (isReliableGpsLatLng(drvLat, drvLng) && mapDest?.lat != null && mapDest?.lng != null) {
      const liveDriverRoute = publicDirectionsCoordsMapUrl(drvLat, drvLng, mapDest.lat, mapDest.lng);
      if (liveDriverRoute) return liveDriverRoute;
    }
    // Driver assigned but live GPS not synced yet:
    // while going to pickup, keep map focused on pickup (do NOT show full pickup->dropoff route).
    if (hasDriver && navLeg === 'to_pickup') {
      return publicPlaceMapUrl(fromAddr) || publicDirectionsMapUrl(fromAddr, toAddr);
    }
    if (fromGeo && toGeo) {
      const c = publicDirectionsCoordsMapUrl(fromGeo.lat, fromGeo.lng, toGeo.lat, toGeo.lng);
      if (c) return c;
    }
    return publicDirectionsMapUrl(fromAddr, toAddr);
  }, [
    fromAddr,
    toAddr,
    fromGeo,
    toGeo,
    hasDriver,
    liveRow?.driver_live_lat,
    liveRow?.driver_live_lng,
    liveRow?.driver_nav_leg,
    liveRow?.status,
  ]);

  const isCancelled = String(liveRow?.status || '').toLowerCase() === 'cancelled';
  const isDelivered =
    String(liveRow?.status || '').toLowerCase() === 'completed' ||
    String(liveRow?.status || '').toLowerCase() === 'delivered';

  useEffect(() => {
    if (!isDelivered || !hasDriver) return;
    navigate('/rate', {
      replace: true,
      state: {
        order: { id: orderId, from: fromAddr, to: toAddr, driver: driverUi },
        reviewContext: {
          bookingTable: isDelivery ? 'customer_delivery_orders' : rideTable,
          bookingId: pollTarget,
          revieweeDriverId: liveDriverRow?.id || null,
        },
      },
    });
  }, [isDelivered, hasDriver, navigate, orderId, fromAddr, toAddr, driverUi, isDelivery, rideTable, pollTarget, liveDriverRow?.id]);

  return (
    <div className="lt-page lt-page--premium" role="main" aria-label="Track order">
      <header className="lt-nav">
        <Link to="/home" className="lt-nav__back" aria-label="Back to home" replace>
          <BackArrow />
        </Link>
        <h1 className="lt-nav__title">Track Order</h1>
        <Link to="/help-support" className="lt-nav__help">
          Help
        </Link>
      </header>

      <div className="lt-body">
        <div className="lt-order-bar">
          <p className="lt-order-bar__id">{orderId}</p>
          <div className="lt-order-bar__eta">
            <span className="lt-order-bar__eta-lab">Estimated delivery</span>
            <span className="lt-order-bar__eta-val">{etaDisplay}</span>
          </div>
        </div>

        <div className={`lt-map-card${trackingMapSrc ? ' lt-map-card--gmap' : ''}`}>
          <GoogleMapEmbed src={trackingMapSrc} title="Route map" loading="eager" />
          {!trackingMapSrc ? (
            <>
              <div className="lt-map-card__route" aria-hidden />
              <div className="lt-map-card__pin lt-map-card__pin--store">
                <MapStoreIcon />
              </div>
              <div className="lt-map-card__pin lt-map-card__pin--rider">
                <MapRiderIcon />
              </div>
              <div className="lt-map-card__pin lt-map-card__pin--home">
                <MapHomeIcon />
              </div>
            </>
          ) : null}
        </div>

        {pollErr ? (
          <p className="lt-alert" role="alert">
            {pollErr}
          </p>
        ) : null}
        {isCancelled ? (
          <p className="lt-alert lt-alert--info" role="status">
            This order has been cancelled.
          </p>
        ) : null}

        <section className="lt-timeline-card" aria-label="Order progress">
          <ol className="lt-timeline">
            {TIMELINE_STEPS.map((s, i) => {
              const st = getTimelineStepState(i, activeIndex);
              const time =
                st === 'pending' ? '—' : stepTimes[i] || (st === 'active' ? '—' : null);
              return (
                <li
                  key={s.id}
                  className={`lt-timeline__item lt-timeline__item--${st}`}
                >
                  <span className="lt-timeline__marker" aria-hidden>
                    {st === 'done' ? (
                      <svg viewBox="0 0 12 12" width="11" height="11" fill="none">
                        <path
                          d="M1.5 5.5l3 3.5L10 1.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span className="lt-timeline__label">{s.label}</span>
                  <span className="lt-timeline__time">{time || '—'}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {hasDriver ? (
          <section className="lt-rider-card" aria-label="Your rider">
            <div className="lt-rider-card__avatar oc-avatar" aria-hidden />
            <div className="lt-rider-card__info">
              <span className="lt-rider-card__role">Rider</span>
              <p className="lt-rider-card__name">{driverUi.name}</p>
              <p className="lt-rider-card__rating">
                {driverRating} <span aria-hidden>★</span>
              </p>
            </div>
            <div className="lt-rider-card__actions">
              {/\d/.test(String(driverUi.phone || '')) ? (
                <a
                  className="lt-rider-card__btn"
                  href={`tel:${String(driverUi.phone).replace(/[^\d+]/g, '')}`}
                  aria-label="Call rider"
                >
                  <IconPhone />
                </a>
              ) : (
                <button type="button" className="lt-rider-card__btn" aria-label="Call rider" disabled>
                  <IconPhone />
                </button>
              )}
              <button
                type="button"
                className="lt-rider-card__btn"
                aria-label="Message rider"
                onClick={() =>
                  navigate('/chat', {
                    state: { name: driverUi.name, role: 'driver' },
                  })
                }
              >
                <IconChat2 />
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <div className="lt-footer">
        <button
          type="button"
          className="lt-details-btn"
          disabled={!orderDetailsTo}
          onClick={() => orderDetailsTo && navigate(orderDetailsTo)}
        >
          Order Details
        </button>
      </div>
    </div>
  );
}
