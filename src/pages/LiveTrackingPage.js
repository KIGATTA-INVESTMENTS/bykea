import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import LiveTrackingRouteMap from '../components/LiveTrackingRouteMap';
import { useThrottledMapEmbedSrc } from '../hooks/useThrottledMapEmbedSrc';
import { mapDriverRegistrationRow } from '../lib/customerOrderFeed';
import {
  cancelCustomerBooking,
  canCustomerCancelBooking,
  CANCEL_REASON_CUSTOMER,
  sweepAutoCancelStaleBookings,
} from '../lib/customerOrderCancel';
import { deliveryOrderDisplayRef } from '../lib/customerDeliveryOrderPayload';
import DeliveryPin from '../components/DeliveryPin';
import PackagePhotoCapture from '../components/PackagePhotoCapture';
import { DELIVERY_PIN_CUSTOMER_HINT, storedDeliveryPin } from '../lib/deliveryConfirmationCode';
import { isPackagePhotoSrc, persistParcelPackagePhoto } from '../lib/packagePhoto';
import { formatGBP } from '../lib/currency';
import {
  countBookingDriversSeen,
  driversSeenRequestLabel,
  isDriverSearchTimedOut,
  noDriverAvailableDetail,
  noDriverAvailableHeadline,
  shouldAutoAcceptLonePendingBid,
  shouldCustomerPickDriver,
} from '../lib/driverSearchWait';
import {
  customerAcceptDriverBid,
  customerRaiseOffer,
  fetchPendingDriverBidsWithNames,
  getCustomerOfferAmount,
  getMinimumFare,
  roundBidAmount,
} from '../lib/bookingBids';
import {
  DEFAULT_MAP_FALLBACK,
  getGoogleMapsApiKey,
  isInServiceArea,
  isReliableGpsLatLng,
  publicDirectionsCoordsMapUrl,
  publicDirectionsMapUrl,
  publicPlaceMapUrl,
} from '../lib/googleMapsConfig';
import { isDriverLiveFresh } from '../lib/liveTrackTable';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { getCustomerSession } from '../lib/customerSession';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import ConfirmDialog from '../components/ConfirmDialog';
import '../components/ConfirmDialog.css';
import './orderTracking.css';

const TIMELINE_STEPS_RIDE = [
  { id: 'requested', label: 'Ride requested' },
  { id: 'finding', label: 'Finding your driver' },
  { id: 'pickup', label: 'Driver en route to pickup' },
  { id: 'trip', label: 'On the way to destination' },
  { id: 'completed', label: 'Ride completed' },
];

const TIMELINE_STEPS_DELIVERY = [
  { id: 'confirmed', label: 'Order confirmed' },
  { id: 'finding', label: 'Finding your driver' },
  { id: 'pickup', label: 'Heading to pickup' },
  { id: 'transit', label: 'On the way to delivery' },
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

function getTimelineStepState(i, activeIndex, totalSteps) {
  if (activeIndex >= totalSteps) return 'done';
  if (i < activeIndex) return 'done';
  if (i === activeIndex) return 'active';
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

  const rideId = order.taxiBookingId || null;
  const deliveryId = rideId ? null : order.supabaseOrderId || null;
  const rideTable = order.bookingStorageTable || 'taxi_bookings';
  const isRide = Boolean(rideId);
  const isDelivery = Boolean(deliveryId);
  const isTuk = isRide && (order.mode === 'tuk' || String(rideTable).includes('tuk'));
  const pollTarget = rideId || deliveryId || null;

  const [liveRow, setLiveRow] = useState(null);
  const [liveDriverRow, setLiveDriverRow] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const [pollErr, setPollErr] = useState('');
  const [fromGeo, setFromGeo] = useState(null);
  const [toGeo, setToGeo] = useState(null);
  const [waitTick, setWaitTick] = useState(0);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState('');
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [mapsJsBlocked, setMapsJsBlocked] = useState(!getGoogleMapsApiKey());
  const [liveNavStats, setLiveNavStats] = useState(null);
  const [pendingBids, setPendingBids] = useState([]);
  const [raiseDraft, setRaiseDraft] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const [bidMsg, setBidMsg] = useState('');
  const soloAutoClaimRef = useRef('');

  const fromAddr = useMemo(() => {
    if (liveRow?.pickup_location) return String(liveRow.pickup_location).trim();
    if (!isDelivery && order.pickup) return String(order.pickup).trim();
    return String(order.from || order.pickup || '').trim() || DEFAULT_MAP_FALLBACK.label;
  }, [liveRow, isDelivery, order.from, order.pickup]);

  const toAddr = useMemo(() => {
    if (liveRow?.dropoff_location) return String(liveRow.dropoff_location).trim();
    if (liveRow?.destination_location) return String(liveRow.destination_location).trim();
    if (!isDelivery) return rideDestinationFromState(order) || DEFAULT_MAP_FALLBACK.label;
    return String(order.to || order.dropoff || '').trim() || DEFAULT_MAP_FALLBACK.label;
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
    const session = getCustomerSession();
    if (!session?.id) return;
    void sweepAutoCancelStaleBookings(session.id, {
      email: session.email,
      phone: session.phone,
    }).then(() => fetchSnapshot());
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

  const orderId = useMemo(() => {
    if (order.orderId) return formatOrderId(order.orderId);
    if (rideId) return formatOrderId(deliveryOrderDisplayRef(rideId));
    if (deliveryId) return formatOrderId(deliveryOrderDisplayRef(deliveryId));
    return formatOrderId(null);
  }, [order.orderId, rideId, deliveryId]);
  const driverUi = liveDriverRow ? mapDriverRegistrationRow(liveDriverRow) : order.driver || null;

  const hasDriver = Boolean(driverUi);

  const cancelKind = isDelivery ? 'delivery' : isRide ? (isTuk ? 'tuk' : 'taxi') : null;
  const canCancelOrder = useMemo(() => {
    if (!liveRow || !cancelKind) return false;
    return canCustomerCancelBooking(liveRow, cancelKind);
  }, [liveRow, cancelKind]);

  const onCancelOrder = () => {
    if (!pollTarget || !cancelKind || cancelBusy) return;
    const session = getCustomerSession();
    if (!session?.id) return;
    setCancelErr('');
    setCancelConfirmOpen(true);
  };

  const confirmCancelOrder = async () => {
    if (!pollTarget || !cancelKind || cancelBusy) return;
    const session = getCustomerSession();
    if (!session?.id) return;
    setCancelBusy(true);
    setCancelErr('');
    const result = await cancelCustomerBooking({
      kind: cancelKind,
      id: pollTarget,
      appUserId: session.id,
      reason: CANCEL_REASON_CUSTOMER,
    });
    setCancelBusy(false);
    if (!result.ok) {
      setCancelErr(result.error || 'Could not cancel.');
      return;
    }
    setCancelConfirmOpen(false);
    await fetchSnapshot();
  };

  const etaDisplay = useMemo(() => {
    if (liveNavStats?.etaLabel && hasDriver) return liveNavStats.etaLabel;
    const fromRow = String(liveRow?.estimated_duration_label || liveRow?.eta_text || '').trim();
    const raw = fromRow || String(order.eta || '').trim();
    if (raw) return raw.replace(/^Est\.?\s*/i, '');
    return isRide ? '5–10 min' : '20–25 min';
  }, [order.eta, liveRow, isRide, liveNavStats, hasDriver]);

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

  const isCancelled = String(liveRow?.status || '').toLowerCase() === 'cancelled';
  const isDelivered =
    String(liveRow?.status || '').toLowerCase() === 'completed' ||
    String(liveRow?.status || '').toLowerCase() === 'delivered';

  const driverSearchTimedOut = useMemo(
    () => isDriverSearchTimedOut({ liveRow, order, hasDriver }),
    [liveRow, order, hasDriver, waitTick],
  );

  const driversSeenCount = useMemo(() => countBookingDriversSeen(liveRow), [liveRow?.viewed_driver_ids]);
  const driversSeenLabel = useMemo(() => driversSeenRequestLabel(driversSeenCount), [driversSeenCount]);
  const showDriverChoice = shouldCustomerPickDriver(driversSeenCount, pendingBids.length);

  const bidTable = useMemo(() => {
    if (isDelivery) return 'customer_delivery_orders';
    if (isRide && pollTarget) return rideTable;
    return null;
  }, [isDelivery, isRide, pollTarget, rideTable]);

  const minimumFare = useMemo(() => getMinimumFare(liveRow), [liveRow]);
  const currentOffer = useMemo(() => getCustomerOfferAmount(liveRow), [liveRow]);

  useEffect(() => {
    if (!pollTarget || !bidTable || hasDriver || isCancelled || !isSupabaseConfigured || !supabase) {
      setPendingBids([]);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await fetchPendingDriverBidsWithNames(supabase, bidTable, pollTarget);
        if (!cancelled) setPendingBids(rows);
      } catch {
        if (!cancelled) setPendingBids([]);
      }
    };
    load();
    const id = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollTarget, bidTable, hasDriver, isCancelled, pollTick]);

  const lonePendingBidId = pendingBids.length === 1 ? pendingBids[0]?.id : '';
  useEffect(() => {
    if (hasDriver || isCancelled || bidBusy) return;
    if (!shouldAutoAcceptLonePendingBid(driversSeenCount, pendingBids.length)) return;
    if (!lonePendingBidId) return;
    const session = getCustomerSession();
    if (!session?.id || !isSupabaseConfigured || !supabase) return;
    if (soloAutoClaimRef.current === lonePendingBidId) return;
    soloAutoClaimRef.current = lonePendingBidId;
    setBidBusy(true);
    void customerAcceptDriverBid(supabase, lonePendingBidId, session.id).then(async (res) => {
      setBidBusy(false);
      if (!res.ok) {
        setBidMsg(res.error || 'Could not assign driver.');
        return;
      }
      setBidMsg('Driver assigned — they are on the way.');
      await fetchSnapshot();
    });
  }, [
    hasDriver,
    isCancelled,
    bidBusy,
    driversSeenCount,
    pendingBids.length,
    lonePendingBidId,
    fetchSnapshot,
  ]);

  const onAcceptDriverBid = async (bidId) => {
    const session = getCustomerSession();
    if (!session?.id || bidBusy) return;
    setBidBusy(true);
    setBidMsg('');
    const res = await customerAcceptDriverBid(supabase, bidId, session.id);
    setBidBusy(false);
    if (!res.ok) {
      setBidMsg(res.error || 'Could not accept bid.');
      return;
    }
    setBidMsg('Driver chosen — they are on the way.');
    await fetchSnapshot();
  };

  const onRaiseOffer = async () => {
    const session = getCustomerSession();
    if (!session?.id || !bidTable || !pollTarget || bidBusy) return;
    const amount = Number(raiseDraft);
    if (!Number.isFinite(amount)) {
      setBidMsg('Enter a valid amount.');
      return;
    }
    setBidBusy(true);
    setBidMsg('');
    const res = await customerRaiseOffer(supabase, bidTable, pollTarget, session.id, amount);
    setBidBusy(false);
    if (!res.ok) {
      setBidMsg(res.error || 'Could not update offer.');
      return;
    }
    setBidMsg(`Offer raised to ${formatGBP(res.amount)}.`);
    setRaiseDraft('');
    await fetchSnapshot();
  };

  useEffect(() => {
    if (!pollTarget || hasDriver || isCancelled) return undefined;
    const id = window.setInterval(() => setWaitTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [pollTarget, hasDriver, isCancelled]);

  const deliveryConfirmationCode = useMemo(() => {
    return (
      storedDeliveryPin(liveRow?.delivery_confirmation_code) ||
      storedDeliveryPin(order.deliveryConfirmationCode) ||
      ''
    );
  }, [liveRow?.delivery_confirmation_code, order.deliveryConfirmationCode]);

  const timelineSteps = isDelivery ? TIMELINE_STEPS_DELIVERY : TIMELINE_STEPS_RIDE;

  const activeIndex = useMemo(() => {
    if (!pollTarget) return 1;
    const st = String(liveRow?.status || '').toLowerCase();
    const navLeg = String(liveRow?.driver_nav_leg || '').toLowerCase();
    if (st === 'completed' || st === 'delivered') return timelineSteps.length;
    if (!hasDriver) return 1;
    if (navLeg === 'to_dropoff' || st === 'transit') return 3;
    if (hasDriver && (st === 'assigned' || st === 'confirmed' || navLeg === 'to_pickup')) return 2;
    return 1;
  }, [pollTarget, hasDriver, liveRow, timelineSteps.length]);

  const statusHeadline = useMemo(() => {
    if (isCancelled) {
      const reason = String(liveRow?.cancel_reason || '').trim();
      const by = String(liveRow?.cancelled_by || '').toLowerCase();
      const who = by === 'driver' ? ' by the driver' : by === 'customer' ? ' by you' : '';
      const base = isRide ? `This ride was cancelled${who}.` : `This order was cancelled${who}.`;
      return reason ? `${base.replace(/\.$/, '')} — ${reason}.` : base;
    }
    if (!pollTarget) return isRide ? 'Connecting to your ride…' : 'Connecting to your order…';
    if (!hasDriver && driverSearchTimedOut) return noDriverAvailableHeadline();
    if (!hasDriver) return isRide ? 'Finding a driver for your ride…' : 'Finding a driver for you…';
    const navLeg = String(liveRow?.driver_nav_leg || '').toLowerCase();
    const st = String(liveRow?.status || '').toLowerCase();
    if (st === 'delivered' || st === 'completed') return isRide ? 'Ride completed' : 'Delivered';
    if (navLeg === 'to_dropoff' || st === 'transit') {
      return isRide
        ? 'Your driver is taking you to your destination'
        : 'Driver is on the way to your delivery address';
    }
    return isRide ? 'Your driver is on the way to pick you up' : 'Driver is heading to the pickup location';
  }, [pollTarget, hasDriver, driverSearchTimedOut, liveRow, isRide, isCancelled]);

  const priceDisplay = useMemo(() => {
    const agreed = Number(liveRow?.agreed_fare_amount);
    if (Number.isFinite(agreed) && agreed > 0) return formatGBP(agreed);
    const liveTotal = isDelivery ? Number(liveRow?.total_amount) : Number(liveRow?.quoted_price);
    const offer = getCustomerOfferAmount(liveRow);
    if (Number.isFinite(offer) && offer > 0) return formatGBP(offer);
    if (Number.isFinite(liveTotal) && liveTotal > 0) return formatGBP(liveTotal);
    if (order.priceLabel) return String(order.priceLabel);
    const n = Number(order.priceNum ?? order.quotedPrice);
    if (Number.isFinite(n) && n > 0) return formatGBP(n);
    return null;
  }, [liveRow?.total_amount, order.priceLabel, order.priceNum, order.quotedPrice]);

  const placedIso = liveRow?.created_at || order.placedAt;
  const stepTimes = useMemo(() => {
    const base = placedIso ? new Date(placedIso) : null;
    const offsets = [0, 3, 8, 15, 25];
    if (!base || Number.isNaN(+base)) {
      return timelineSteps.map((_, i) => (i < 3 ? ['12:30 PM', '12:33 PM', '12:40 PM'][i] : null));
    }
    const addMin = (m) => new Date(base.getTime() + m * 60000);
    return timelineSteps.map((_, i) => {
      if (i === timelineSteps.length - 1 && activeIndex >= timelineSteps.length) {
        return formatShortTime(liveRow?.updated_at || liveRow?.completed_at || liveRow?.delivered_at);
      }
      if (i > activeIndex) return null;
      return formatShortTime(addMin(offsets[i] ?? i * 5));
    });
  }, [placedIso, activeIndex, liveRow, timelineSteps]);

  const trackingMapSrc = useMemo(() => {
    if (!fromAddr || !toAddr) return '';
    const drvLat = Number(Number(liveRow?.driver_live_lat).toFixed(4));
    const drvLng = Number(Number(liveRow?.driver_live_lng).toFixed(4));
    const dbStatus = String(liveRow?.status || '').toLowerCase();
    const navLegRaw = String(liveRow?.driver_nav_leg || '').toLowerCase();
    const navLeg =
      navLegRaw === 'to_dropoff' || dbStatus === 'transit' || dbStatus === 'completed' ? 'to_dropoff' : 'to_pickup';
    const mapDest = navLeg === 'to_dropoff' ? toGeo : fromGeo;
    const driverLiveOk =
      hasDriver &&
      isDriverLiveFresh(liveRow) &&
      isReliableGpsLatLng(drvLat, drvLng) &&
      isInServiceArea(drvLat, drvLng) &&
      mapDest?.lat != null &&
      mapDest?.lng != null;
    if (driverLiveOk) {
      const liveDriverRoute = publicDirectionsCoordsMapUrl(drvLat, drvLng, mapDest.lat, mapDest.lng);
      if (liveDriverRoute) return liveDriverRoute;
    }
    if (!hasDriver && fromGeo && toGeo) {
      const fullRoute = publicDirectionsCoordsMapUrl(fromGeo.lat, fromGeo.lng, toGeo.lat, toGeo.lng);
      if (fullRoute) return fullRoute;
    }
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
    liveRow,
    liveRow?.driver_live_lat,
    liveRow?.driver_live_lng,
    liveRow?.driver_live_updated_at,
    liveRow?.driver_nav_leg,
    liveRow?.status,
  ]);

  const mapBumpKey = useMemo(() => {
    const navLeg = String(liveRow?.driver_nav_leg || '').toLowerCase();
    return `${hasDriver ? '1' : '0'}-${navLeg}-${fromGeo?.lat ?? 'x'}-${toGeo?.lat ?? 'x'}`;
  }, [hasDriver, liveRow?.driver_nav_leg, fromGeo?.lat, toGeo?.lat]);

  const stableTrackingMapSrc = useThrottledMapEmbedSrc(trackingMapSrc, {
    throttleMs: 12000,
    bumpKey: mapBumpKey,
  });

  const navLeg = useMemo(() => {
    const dbStatus = String(liveRow?.status || '').toLowerCase();
    const navLegRaw = String(liveRow?.driver_nav_leg || '').toLowerCase();
    return navLegRaw === 'to_dropoff' || dbStatus === 'transit' || dbStatus === 'completed'
      ? 'to_dropoff'
      : 'to_pickup';
  }, [liveRow?.driver_nav_leg, liveRow?.status]);

  const driverLiveOk = useMemo(() => {
    const drvLat = Number(liveRow?.driver_live_lat);
    const drvLng = Number(liveRow?.driver_live_lng);
    return (
      hasDriver &&
      isDriverLiveFresh(liveRow) &&
      isReliableGpsLatLng(drvLat, drvLng) &&
      isInServiceArea(drvLat, drvLng)
    );
  }, [hasDriver, liveRow]);

  const useLiveRouteMap = !mapsJsBlocked && (fromGeo || toGeo);

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

  const pageTitle = isRide ? (isTuk ? 'Track your tuk-tuk' : 'Track your ride') : 'Track delivery';
  const etaLabel = useMemo(() => {
    if (!hasDriver) return isRide ? 'Est. pickup' : 'Estimated arrival';
    if (navLeg === 'to_pickup') return isDelivery ? 'Driver to pickup' : 'Driver to you';
    return isRide ? 'Est. arrival' : 'To delivery';
  }, [hasDriver, navLeg, isRide, isDelivery]);
  const detailsLabel = isRide ? 'Ride details' : 'Order details';

  return (
    <div
      className={`lt-page lt-page--premium${isRide ? ' lt-page--ride' : ' lt-page--delivery'}`}
      role="main"
      aria-label={pageTitle}
    >
      <header className="lt-nav">
        <Link to="/home" className="lt-nav__back" aria-label="Back to home" replace>
          <BackArrow />
        </Link>
        <h1 className="lt-nav__title">{pageTitle}</h1>
        <Link to="/help-support" className="lt-nav__help">
          Help
        </Link>
      </header>

      <div className="lt-body">
        <div className="lt-order-bar">
          <div>
            <p className="lt-order-bar__id">{orderId}</p>
            {priceDisplay ? (
              <p className="lt-order-bar__price">{isRide ? 'Quoted fare' : 'Total'} {priceDisplay}</p>
            ) : null}
          </div>
          <div className="lt-order-bar__eta">
            <span className="lt-order-bar__eta-lab">{etaLabel}</span>
            <span className="lt-order-bar__eta-val">{etaDisplay}</span>
            {liveNavStats?.distanceLabel && hasDriver ? (
              <span className="lt-order-bar__eta-sub">{liveNavStats.distanceLabel} away</span>
            ) : null}
          </div>
        </div>

        <p
          className={`lt-status-banner${
            !hasDriver && pollTarget && !driverSearchTimedOut ? ' lt-status-banner--pulse' : ''
          }${driverSearchTimedOut && !hasDriver ? ' lt-status-banner--warn' : ''}`}
          role="status"
        >
          {statusHeadline}
        </p>

        {!hasDriver && pollTarget && !isCancelled && bidTable ? (
          <section className="lt-bid-card" aria-label={showDriverChoice ? 'Choose your driver' : 'Your fare'}>
            <h2 className="lt-bid-card__title">{showDriverChoice ? 'Choose your driver' : 'Your fare'}</h2>
            <p className="lt-bid-card__meta">
              Your offer: <strong>{formatGBP(currentOffer)}</strong>
              {minimumFare > 0 && minimumFare < currentOffer ? (
                <> · Min. {formatGBP(minimumFare)}</>
              ) : minimumFare > 0 ? (
                <> · Admin minimum {formatGBP(minimumFare)}</>
              ) : null}
            </p>

            {showDriverChoice ? (
              <ul className="lt-bid-list">
                {pendingBids.map((b) => (
                  <li key={b.id} className="lt-bid-list__item">
                    <div className="lt-bid-list__info">
                      <p className="lt-bid-list__name">{b.driver_name || 'Driver'}</p>
                      {b.vehicle_label ? <p className="lt-bid-list__veh">{b.vehicle_label}</p> : null}
                      <p className="lt-bid-list__amt">{formatGBP(b.amount)}</p>
                    </div>
                    <button
                      type="button"
                      className="lt-bid-list__accept"
                      disabled={bidBusy}
                      onClick={() => onAcceptDriverBid(b.id)}
                    >
                      {bidBusy ? '…' : 'Choose driver'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : pendingBids.length === 1 && driversSeenCount >= 2 ? (
              <p className="lt-bid-card__hint">
                1 driver has offered. You can choose once another driver who has seen the request also offers.
              </p>
            ) : (
              <p className="lt-bid-card__hint">
                {driversSeenCount >= 2
                  ? 'More than one driver has seen this request. You will choose when at least two offer.'
                  : 'If only one driver sees this request, they are assigned when they offer. You choose only when more than one has seen it.'}
              </p>
            )}

            <div className="lt-bid-raise">
              <label className="lt-bid-raise__lbl" htmlFor="lt-raise-offer">
                Raise your offer (min {formatGBP(Math.max(minimumFare, currentOffer))})
              </label>
              <div className="lt-bid-raise__row">
                <input
                  id="lt-raise-offer"
                  type="number"
                  step="0.5"
                  min={Math.max(minimumFare, currentOffer)}
                  className="lt-bid-raise__input"
                  value={raiseDraft}
                  onChange={(e) => setRaiseDraft(e.target.value)}
                  placeholder={String(roundBidAmount(currentOffer + 0.5).toFixed(2))}
                />
                <button type="button" className="lt-bid-raise__btn" disabled={bidBusy} onClick={onRaiseOffer}>
                  {bidBusy ? '…' : 'Raise'}
                </button>
              </div>
            </div>
            {bidMsg ? (
              <p className="lt-bid-card__msg" role="status">
                {bidMsg}
              </p>
            ) : null}
          </section>
        ) : null}

        {!hasDriver && pollTarget && !isCancelled ? (
          <section
            className={`lt-finding-card${driverSearchTimedOut ? ' lt-finding-card--unavailable' : ''}`}
            aria-label={driverSearchTimedOut ? 'No driver available' : 'Driver search'}
            aria-live="polite"
          >
            {!driverSearchTimedOut ? <div className="lt-finding-card__spinner" aria-hidden /> : null}
            <div>
              <p className="lt-finding-card__title">
                {driverSearchTimedOut
                  ? noDriverAvailableHeadline()
                  : showDriverChoice
                    ? 'Drivers are ready — choose one above'
                    : pendingBids.length === 1 && driversSeenCount >= 2
                      ? 'Waiting for another driver to offer'
                      : isRide
                        ? 'Finding drivers for your ride'
                        : 'Finding drivers for your delivery'}
              </p>
              <p className="lt-finding-card__hint">
                {driverSearchTimedOut
                  ? noDriverAvailableDetail({ isRide })
                  : showDriverChoice
                    ? 'Pick a driver from the list. Only the one you choose will be assigned.'
                    : pendingBids.length === 1 && driversSeenCount >= 2
                      ? 'More than one driver has seen your request, so you will choose — waiting for a second offer.'
                      : driversSeenCount >= 2
                        ? 'More than one driver has seen your request. You will choose among them when they offer.'
                        : isRide
                          ? 'Nearby drivers are being notified. If only one sees this ride, they are assigned automatically.'
                          : 'Nearby drivers are being notified. If only one sees this delivery, they are assigned automatically.'}
              </p>
              {!driverSearchTimedOut && driversSeenLabel ? (
                <p className="lt-finding-card__seen">{driversSeenLabel}</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {isRide || isDelivery ? (
          <div className="lt-route-summary" aria-label="Route">
            <p className="lt-route-summary__row">
              <span className="lt-route-summary__dot lt-route-summary__dot--pickup" aria-hidden />
              <span className="lt-route-summary__text">{fromAddr}</span>
            </p>
            <p className="lt-route-summary__row">
              <span className="lt-route-summary__dot lt-route-summary__dot--drop" aria-hidden />
              <span className="lt-route-summary__text">{toAddr}</span>
            </p>
          </div>
        ) : null}

        <div className={`lt-map-card${useLiveRouteMap || stableTrackingMapSrc ? ' lt-map-card--gmap lt-map-card--nav' : ''}`}>
          {useLiveRouteMap ? (
            <LiveTrackingRouteMap
              pickupGeo={fromGeo}
              dropoffGeo={toGeo}
              driverLat={liveRow?.driver_live_lat}
              driverLng={liveRow?.driver_live_lng}
              driverLiveOk={driverLiveOk}
              navLeg={navLeg}
              hasDriver={hasDriver}
              onNavStats={setLiveNavStats}
              onLoadError={() => setMapsJsBlocked(true)}
            />
          ) : (
            <GoogleMapEmbed src={stableTrackingMapSrc} title="Route map" loading="eager" />
          )}
          {!useLiveRouteMap && !stableTrackingMapSrc ? (
            <>
              <div className="lt-map-card__route" aria-hidden />
              {isDelivery ? (
                <div className="lt-map-card__pin lt-map-card__pin--store">
                  <MapStoreIcon />
                </div>
              ) : (
                <div className="lt-map-card__pin lt-map-card__pin--pickup">
                  <MapRiderIcon />
                </div>
              )}
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
        {cancelErr ? (
          <p className="lt-alert" role="alert">
            {cancelErr}
          </p>
        ) : null}
        {isDelivery && deliveryConfirmationCode && !isDelivered && !isCancelled ? (
          <section className="lt-delivery-code" aria-label="Delivery PIN">
            <p className="lt-delivery-code__label">Your delivery PIN</p>
            <DeliveryPin value={deliveryConfirmationCode} readOnly ariaLabel="Your delivery PIN" />
            <p className="lt-delivery-code__hint">{DELIVERY_PIN_CUSTOMER_HINT}</p>
          </section>
        ) : null}
        {isDelivery && pollTarget && !isCancelled ? (
          <section className="lt-pkg-photo" aria-label="Package photos">
            <PackagePhotoCapture
              value={isPackagePhotoSrc(liveRow?.package_photo_data_url) ? liveRow.package_photo_data_url : ''}
              onChange={async (url, name) => {
                setLiveRow((prev) =>
                  prev ? { ...prev, package_photo_data_url: url, package_photo_filename: name || prev.package_photo_filename } : prev,
                );
                const saved = await persistParcelPackagePhoto('customer', pollTarget, url, name);
                if (!saved.ok) setPollErr(saved.error || 'Could not save package photo.');
              }}
              label="Your package photo"
              hint={
                isDelivered
                  ? 'Photo of the parcel for this delivery.'
                  : 'Take or upload a photo of the parcel. Your driver will see this at pickup.'
              }
              disabled={isDelivered}
            />
            {isPackagePhotoSrc(liveRow?.driver_package_photo_data_url) ? (
              <figure className="da-packagePhotoWrap" style={{ marginTop: '0.75rem' }}>
                <figcaption className="da-packagePhotoCap">Driver photo at pickup</figcaption>
                <img
                  className="da-packagePhotoImg"
                  src={liveRow.driver_package_photo_data_url}
                  alt="Package photographed by driver"
                />
              </figure>
            ) : null}
          </section>
        ) : null}
        {isCancelled ? (
          <p className="lt-alert lt-alert--info" role="status">
            {String(liveRow?.cancel_reason || '').trim()
              ? `Cancelled — ${liveRow.cancel_reason}`
              : 'This order has been cancelled.'}
          </p>
        ) : null}

        <section className="lt-timeline-card" aria-label={isRide ? 'Ride progress' : 'Delivery progress'}>
          <ol className="lt-timeline">
            {timelineSteps.map((s, i) => {
              const st = getTimelineStepState(i, activeIndex, timelineSteps.length);
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
              <span className="lt-rider-card__role">{isDelivery ? 'Driver' : 'Rider'}</span>
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
        {canCancelOrder && !hasDriver && !isCancelled ? (
          <button type="button" className="lt-cancel" disabled={cancelBusy} onClick={onCancelOrder}>
            {cancelBusy ? 'Cancelling…' : 'Cancel order'}
          </button>
        ) : null}
        <button
          type="button"
          className="lt-details-btn"
          disabled={!orderDetailsTo}
          onClick={() => orderDetailsTo && navigate(orderDetailsTo)}
        >
          {detailsLabel}
        </button>
      </div>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel this order?"
        message="You can place a new one anytime. This cannot be undone."
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
