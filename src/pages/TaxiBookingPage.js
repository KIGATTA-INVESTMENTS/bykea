import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { getCustomerSession } from '../lib/customerSession';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import BikeIcon from '../components/icons/BikeIcon';
import CarIcon from '../components/icons/CarIcon';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import LiveUserGoogleMap from '../components/LiveUserGoogleMap';
import LocationPermissionPrompt from '../components/LocationPermissionPrompt';
import LiveUserMapPuck from '../components/LiveUserMapPuck';
import { useLiveLocation } from '../hooks/useLiveLocation';
import {
  getGoogleMapsApiKey,
  publicDirectionsCoordsMapUrl,
  publicPlaceMapUrl,
  publicViewMapUrl,
} from '../lib/googleMapsConfig';
import {
  effectiveBillableKm,
  estimateDriveMinutes,
  estimateRoadKm,
  haversineKm,
} from '../lib/routeEstimate';
import {
  geolocationFailureMessage,
  pickupLineFromCoords,
} from '../lib/devicePickupLocation';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { deliveryOrderDisplayRef } from '../lib/customerDeliveryOrderPayload';
import { postLocalPaynowInitiate, resolveShopPaynowLocalInitiateUrl } from '../lib/shopPaynowLocal';
import { writeShopOrderConfirmationState } from '../lib/shopOrderConfirmationSession';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import AddressSuggestInput from '../components/AddressSuggestInput';
import './requestFlow.css';
import './taxiAndShop.css';
import './pePayment.css';
import './bookRide.css';

const LONDON_CENTER = { lat: 51.5074, lng: -0.1278 };

/** Single-card meta for /book-tuk-tuk (variant tukOnly). */
const TUK_ONLY_META = {
  id: 'tuk',
  label: 'Tuk-Tuk',
  passengers: '1–2 passengers',
};

/** /book-ride — matches `taxi_bookings.vehicle_type` (bicycle | tuktuk | car | minibus). */
const RIDE_TYPES = [
  {
    id: 'bicycle',
    label: 'Bike',
    passengers: '1 rider',
    price: 0.9,
    eta: '12 mins',
  },
  {
    id: 'tuktuk',
    label: 'Tuk-Tuk',
    passengers: '1–2 passengers',
    price: 1.2,
    eta: '8 mins',
  },
  {
    id: 'car',
    label: 'Car',
    passengers: '1–4 passengers',
    price: 2.5,
    eta: '5 mins',
  },
  {
    id: 'minibus',
    label: 'Mini Bus',
    passengers: '5–16 passengers',
    price: 4.2,
    eta: '7 mins',
  },
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

function GpsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="4.5" strokeWidth="1.3" fill="none" />
      <path d="M12 3.5V7M12 17v3.5M3.5 12H7M17 12h3.5" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function MapPinA() {
  return (
    <svg viewBox="0 0 32 40" width="36" height="44" aria-hidden>
      <path
        d="M16 2.5C10.2 2.5 5.5 7.1 5.5 12.6c0 4.6 2.1 6.1 3.1 7.1l7.4 9.1 7.4-9.1c1-1.1 3-2.3 3-7.1C26.4 7.1 21.7 2.5 16 2.5Z"
        fill="#F18631"
      />
      <circle cx="16" cy="12" r="4" fill="white" />
    </svg>
  );
}
function MapPinB() {
  return (
    <svg viewBox="0 0 32 40" width="36" height="44" aria-hidden>
      <path
        d="M16 2.5C10.2 2.5 5.5 7.1 5.5 12.6c0 4.6 2.1 6.1 3.1 7.1l7.4 9.1 7.4-9.1c1-1.1 3-2.3 3-7.1C26.4 7.1 21.7 2.5 16 2.5Z"
        fill="#e53935"
      />
      <circle cx="16" cy="12" r="4" fill="white" />
    </svg>
  );
}

function IconCardRide() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#333" strokeWidth="1.3" aria-hidden>
      <rect x="3" y="7" width="26" height="18" rx="2" fill="#fff" />
      <path d="M3 12h26" stroke="#F18631" strokeWidth="2" />
      <rect x="5" y="18" width="7" height="2" rx="0.5" fill="#ccc" />
    </svg>
  );
}
function IconStripeRide() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <rect x="3" y="7" width="26" height="18" rx="2" fill="#635bff" />
      <path d="M3 12h26" fill="#0a2540" opacity="0.25" />
      <rect x="6" y="17" width="10" height="3" rx="0.5" fill="#c4f4ff" opacity="0.9" />
    </svg>
  );
}
function IconCashRide() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <rect x="3" y="5" width="20" height="12" rx="1" fill="#F18631" transform="rotate(-8 16 12)" />
      <rect
        x="5"
        y="10"
        width="20"
        height="12"
        rx="1"
        fill="#0A58A6"
        transform="rotate(4 16 16)"
        opacity="0.95"
      />
      <rect
        x="6"
        y="14"
        width="20"
        height="12"
        rx="1"
        fill="white"
        transform="rotate(-2 16 20)"
        stroke="#e0e0e0"
        strokeWidth="0.5"
      />
    </svg>
  );
}

function IconTuk() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden>
      <rect x="3" y="10" width="16" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path
        d="M19 12h4l1.2 1.2h1.3a.9.9 0 0 1 .8.5V16"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <circle cx="6" cy="19.2" r="1.3" fill="currentColor" />
      <circle cx="14" cy="19.2" r="1.3" fill="currentColor" />
      <circle cx="26" cy="19.2" r="1.3" fill="currentColor" />
    </svg>
  );
}
function IconCar() {
  return <CarIcon size={32} />;
}

function IconMinibus() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden>
      <rect x="3.5" y="11" width="23" height="8" rx="1" stroke="currentColor" strokeWidth="1.35" fill="none" />
      <path d="M23.5 11V8.5a1 1 0 0 1 1-1h2.5a2 2 0 0 1 1.7 1l1.3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="5" y="13" width="4" height="3" rx="0.35" stroke="currentColor" strokeWidth="0.9" fill="none" />
      <rect x="10.5" y="13" width="4" height="3" rx="0.35" stroke="currentColor" strokeWidth="0.9" fill="none" />
      <rect x="16" y="13" width="4" height="3" rx="0.35" stroke="currentColor" strokeWidth="0.9" fill="none" />
      <circle cx="9" cy="21.2" r="1.35" fill="currentColor" />
      <circle cx="16" cy="21.2" r="1.35" fill="currentColor" />
      <circle cx="23" cy="21.2" r="1.35" fill="currentColor" />
    </svg>
  );
}

const ICONS = { bicycle: BikeIcon, tuktuk: IconTuk, car: IconCar, minibus: IconMinibus };

function IconChevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9.5 7.5L14 12l-4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconWalletOpt() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h14a2 2 0 0 1 2 2v1H6a2 2 0 0 1-2-2V8Zm2 9h12a2 2 0 0 0 2-2v-5H6v5a2 2 0 0 0 2 2Z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="13" r="1" fill="currentColor" />
    </svg>
  );
}

/** Relative fare vs car for same distance (straight-line + DB rates). */
const TIER_MULT = { bicycle: 0.5, tuktuk: 0.88, car: 1, minibus: 1.32 };

const FALLBACK_RATES = {
  taxi: { base_fare: 3, price_per_km: 1.2, service_fee: 0.5 },
  tuk_tuk: { base_fare: 2, price_per_km: 0.8, service_fee: 0.35 },
};

function computeRideQuote(roadKm, rates, rideId, isTukOnlyPage) {
  if (roadKm == null || !Number.isFinite(roadKm) || roadKm <= 0 || !rates) return null;
  const eff = effectiveBillableKm(roadKm, 0.5);
  const raw = Number(rates.base_fare) + eff * Number(rates.price_per_km) + Number(rates.service_fee);
  if (!Number.isFinite(raw)) return null;
  const mult = isTukOnlyPage ? 1 : TIER_MULT[rideId] ?? TIER_MULT.car;
  return Math.round(raw * mult * 100) / 100;
}

function createStop() {
  return { id: `${Date.now()}-${Math.random()}` };
}

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function TaxiBookingPage({ variant = 'full' } = {}) {
  const isTukOnly = variant === 'tukOnly';
  const storageTable = isTukOnly ? 'tuk_tuk_bookings' : 'taxi_bookings';
  const navigate = useNavigate();
  const live = useLiveLocation({ mapThrottleMs: 4000 });
  const hasMapsKey = Boolean(getGoogleMapsApiKey());
  const [rideJsMapFailed, setRideJsMapFailed] = useState(false);
  const [selected, setSelected] = useState(isTukOnly ? 'tuktuk' : 'car');
  const [pickup, setPickup] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsNotice, setGpsNotice] = useState('');
  const [stops, setStops] = useState([createStop()]);
  const [coordsRouteSrc, setCoordsRouteSrc] = useState('');
  const [bookError, setBookError] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const showRidePaynow = useMemo(() => Boolean(resolveShopPaynowLocalInitiateUrl()), []);
  const showRideStripe = useMemo(() => isStripePaymentsConfigured(), []);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [showFareDetails, setShowFareDetails] = useState(false);
  const [showPaymentPanel, setShowPaymentPanel] = useState(false);

  const ridePaymentMethods = useMemo(() => {
    const rows = [{ id: 'cod', label: 'Cash on delivery', Icon: IconCashRide }];
    if (showRidePaynow) rows.push({ id: 'card', label: 'Paynow', Icon: IconCardRide });
    if (showRideStripe) rows.push({ id: 'stripe', label: 'Card', Icon: IconStripeRide });
    return rows;
  }, [showRidePaynow, showRideStripe]);

  useEffect(() => {
    if (paymentMethod === 'card' && !showRidePaynow) setPaymentMethod(showRideStripe ? 'stripe' : 'cod');
    if (paymentMethod === 'stripe' && !showRideStripe) setPaymentMethod(showRidePaynow ? 'card' : 'cod');
  }, [paymentMethod, showRidePaynow, showRideStripe]);

  const [estimateLoading, setEstimateLoading] = useState(false);
  const [roadKm, setRoadKm] = useState(null);
  const [durationMins, setDurationMins] = useState(null);
  const [rates, setRates] = useState(() => (isTukOnly ? FALLBACK_RATES.tuk_tuk : FALLBACK_RATES.taxi));

  const distanceLabel = useMemo(() => {
    if (estimateLoading) return '…';
    if (roadKm == null) return '—';
    return `${roadKm.toFixed(1)} km`;
  }, [estimateLoading, roadKm]);

  const durationLabel = useMemo(() => {
    if (estimateLoading) return '…';
    if (durationMins == null) return '—';
    return `${Math.max(1, Math.round(durationMins))} mins`;
  }, [estimateLoading, durationMins]);

  const selectedQuote = useMemo(
    () => computeRideQuote(roadKm, rates, selected, isTukOnly),
    [roadKm, rates, selected, isTukOnly],
  );

  const setDropoff = (v) => {
    setStops((prev) => {
      const next = [...prev];
      next[0] = { ...next[0], value: v };
      return next;
    });
  };

  const debouncedPickup = useDebouncedValue(pickup.trim(), 400);
  const debouncedStops = useDebouncedValue(stops, 400);

  useEffect(() => {
    let cancelled = false;
    const svc = isTukOnly ? 'tuk_tuk' : 'taxi';
    if (!isSupabaseConfigured || !supabase) {
      setRates(isTukOnly ? FALLBACK_RATES.tuk_tuk : FALLBACK_RATES.taxi);
      return undefined;
    }
    (async () => {
      const { data } = await supabase
        .from('service_pricing')
        .select('price_per_km, base_fare, service_fee')
        .eq('service_type', svc)
        .maybeSingle();
      if (cancelled) return;
      const pk = data?.price_per_km != null ? Number(data.price_per_km) : NaN;
      const bf = data?.base_fare != null ? Number(data.base_fare) : NaN;
      const sf = data?.service_fee != null ? Number(data.service_fee) : NaN;
      const fb = isTukOnly ? FALLBACK_RATES.tuk_tuk : FALLBACK_RATES.taxi;
      setRates({
        price_per_km: Number.isFinite(pk) && pk >= 0 ? pk : fb.price_per_km,
        base_fare: Number.isFinite(bf) && bf >= 0 ? bf : fb.base_fare,
        service_fee: Number.isFinite(sf) && sf >= 0 ? sf : fb.service_fee,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isTukOnly]);

  useEffect(() => {
    let cancelled = false;
    const p = debouncedPickup.trim();
    const stopTexts = debouncedStops.map((s) => (s?.value ?? '').trim()).filter(Boolean);
    if (!p || stopTexts.length < 1) {
      setCoordsRouteSrc('');
      setRoadKm(null);
      setDurationMins(null);
      setEstimateLoading(false);
      return undefined;
    }

    const destinationText = stopTexts[stopTexts.length - 1];
    const middleTexts = stopTexts.length > 1 ? stopTexts.slice(0, -1) : [];

    setEstimateLoading(true);
    (async () => {
      try {
        const pickupGeo = await forwardGeocodeAddress(p);
        const destGeo = await forwardGeocodeAddress(destinationText);
        if (cancelled) return;
        if (!pickupGeo || !destGeo) {
          setCoordsRouteSrc('');
          setRoadKm(null);
          setDurationMins(null);
          setEstimateLoading(false);
          return;
        }

        const straight = haversineKm(pickupGeo.lat, pickupGeo.lng, destGeo.lat, destGeo.lng);
        const road = straight != null ? estimateRoadKm(straight) : null;
        if (cancelled) return;
        if (road != null && Number.isFinite(road)) {
          setRoadKm(road);
          setDurationMins(estimateDriveMinutes(road));
        } else {
          setRoadKm(null);
          setDurationMins(null);
        }

        let waypointPairs = [];
        if (middleTexts.length) {
          const midGeos = await Promise.all(middleTexts.map((t) => forwardGeocodeAddress(t)));
          waypointPairs = midGeos.filter(Boolean).map((g) => [g.lat, g.lng]);
        }

        const url = publicDirectionsCoordsMapUrl(
          pickupGeo.lat,
          pickupGeo.lng,
          destGeo.lat,
          destGeo.lng,
          waypointPairs,
        );
        if (!cancelled) setCoordsRouteSrc(url || '');
      } catch {
        if (!cancelled) {
          setCoordsRouteSrc('');
          setRoadKm(null);
          setDurationMins(null);
        }
      } finally {
        if (!cancelled) setEstimateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedPickup, debouncedStops]);

  const textFallbackMapSrc = useMemo(() => {
    const stopTexts = debouncedStops.map((s) => (s?.value ?? '').trim()).filter(Boolean);
    const dropFirst = stopTexts[0] ?? '';
    const p = debouncedPickup.trim();

    if (p && stopTexts.length >= 1) {
      return publicPlaceMapUrl(p);
    }
    if (p) return publicPlaceMapUrl(p);
    if (dropFirst) return publicPlaceMapUrl(dropFirst);
    const c = live.mapCenter;
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
      return publicViewMapUrl(c.lat, c.lng, 14);
    }
    return publicViewMapUrl(LONDON_CENTER.lat, LONDON_CENTER.lng, 12);
  }, [debouncedPickup, debouncedStops, live.mapCenter]);

  const rideMapSrc = coordsRouteSrc || textFallbackMapSrc;

  const hasPickupAndDestination =
    pickup.trim().length > 0 && (stops[0]?.value ?? '').trim().length > 0;

  /** Same live dot as /home: raw GPS for JS map (mapCenter throttled for embed URLs). */
  const rideInteractiveMapCenter = useMemo(() => {
    if (live.hasFix && live.lat != null && live.lng != null) {
      return { lat: live.lat, lng: live.lng };
    }
    return live.mapCenter;
  }, [live.hasFix, live.lat, live.lng, live.mapCenter]);

  const useRideInteractiveMap = hasMapsKey && !rideJsMapFailed && !coordsRouteSrc;

  const useGps = async () => {
    if (gpsLoading) return;
    setGpsNotice('');
    setGpsLoading(true);
    try {
      const coords = await live.refreshFromUserGesture();
      const line = await pickupLineFromCoords(coords.latitude, coords.longitude);
      setPickup(line);
    } catch (err) {
      const code = typeof err?.code === 'number' ? err.code : 2;
      setGpsNotice(geolocationFailureMessage(code));
    } finally {
      setGpsLoading(false);
    }
  };

  const onBook = async (e) => {
    e.preventDefault();
    setBookError('');
    const pu = pickup.trim();
    const dest = String(stops[0]?.value ?? '').trim();
    if (!pu || !dest) {
      setBookError('Please enter pickup and destination.');
      return;
    }
    const quote = computeRideQuote(roadKm, rates, selected, isTukOnly);
    if (quote == null || roadKm == null) {
      setBookError('Could not estimate this route yet. Wait for distance to load, or adjust addresses.');
      return;
    }

    const usePaynowFirst = paymentMethod === 'card' && showRidePaynow;
    const useStripeFirst = paymentMethod === 'stripe' && showRideStripe;
    if (paymentMethod === 'card' && !showRidePaynow) {
      setBookError(
        'Paynow is not configured. The app uses https://bykea-production.up.railway.app by default, or set REACT_APP_SHOP_PAYNOW_LOCAL_URL in .env.local. For local Paynow run `cd server && npm start`, then restart the app — or choose another payment method.',
      );
      return;
    }
    if (paymentMethod === 'stripe' && !showRideStripe) {
      setBookError(
        'Card payments need the app backend configured (Supabase and card payment keys).',
      );
      return;
    }
    if ((usePaynowFirst || useStripeFirst) && (!isSupabaseConfigured || !supabase)) {
      setBookError('Connect Supabase to pay online.');
      return;
    }

    let taxiBookingId = null;
    if (isSupabaseConfigured && supabase) {
      setBookingSubmitting(true);
      try {
        const session = getCustomerSession();
        const rowPayload = isTukOnly
          ? {
              app_user_id: session?.id ?? null,
              pickup_location: pu,
              destination_location: dest,
              estimated_distance_label: distanceLabel,
              estimated_duration_label: durationLabel,
              quoted_price: quote,
              currency: 'USD',
              status: 'requested',
              payment_method: paymentMethod,
            }
          : {
              app_user_id: session?.id ?? null,
              pickup_location: pu,
              destination_location: dest,
              ride_type: selected === 'tuktuk' ? 'tuk' : 'std',
              vehicle_type: selected,
              estimated_distance_label: distanceLabel,
              estimated_duration_label: durationLabel,
              quoted_price: quote,
              currency: 'USD',
              status: 'requested',
              payment_method: paymentMethod,
            };

        const { data, error } = await supabase.from(storageTable).insert(rowPayload).select('id').single();
        if (error) {
          setBookError(error.message || 'Could not save booking.');
          setBookingSubmitting(false);
          return;
        }
        taxiBookingId = data?.id ?? null;

        if (useStripeFirst && taxiBookingId) {
          const displayRef = deliveryOrderDisplayRef(taxiBookingId);
          const amountLabel = FMT.format(quote);
          const liveState = {
            mode: 'taxi',
            pickup: pu,
            stops,
            rideType: selected,
            distanceKm: distanceLabel,
            quotedPrice: quote,
            taxiBookingId,
            bookingStorageTable: storageTable,
            payment_method: 'stripe',
          };
          const rideOrderConfirmation = {
            source: 'ride',
            orderId: displayRef,
            taxiBookingId,
            bookingStorageTable: storageTable,
            mode: 'taxi',
            pickup: pu,
            stops,
            rideType: selected,
            distanceKm: distanceLabel,
            quotedPrice: quote,
            payment_method: 'stripe',
            eta: durationLabel,
            placedAt: new Date().toISOString(),
            priceLabel: amountLabel,
            priceNum: quote,
          };
          setStripeHostedReturnContext({
            flow: 'live_tracking',
            state: liveState,
            rideOrderConfirmation,
          });
          const go = await stripeHostedCheckoutRedirect({
            orderKind: isTukOnly ? 'tuk' : 'taxi',
            orderId: taxiBookingId,
            cancelPath: '/stripe-cancel',
          });
          if (!go.ok) {
            await supabase.from(storageTable).delete().eq('id', taxiBookingId);
            setBookError(go.error || 'Could not start card checkout.');
          }
          setBookingSubmitting(false);
          return;
        }

        if (usePaynowFirst && taxiBookingId) {
          const displayRef = deliveryOrderDisplayRef(taxiBookingId);
          const payRes = await postLocalPaynowInitiate({
            orderKind: isTukOnly ? 'tuk' : 'taxi',
            orderNumber: displayRef,
            orderId: taxiBookingId,
            amount: Number(Number(quote).toFixed(2)),
            customerEmail: session?.email != null ? String(session.email) : '',
            customerPhone: session?.phone != null ? String(session.phone) : '',
            customerName:
              String(session?.full_name || session?.name || '')
                .trim()
                .slice(0, 120) || 'Customer',
          });
          if (!payRes.ok || !payRes.redirectUrl) {
            await supabase.from(storageTable).delete().eq('id', taxiBookingId);
            setBookError(payRes.error || 'Could not start Paynow.');
            setBookingSubmitting(false);
            return;
          }
          writeShopOrderConfirmationState({
            source: 'ride',
            orderId: displayRef,
            taxiBookingId,
            bookingStorageTable: storageTable,
            mode: 'taxi',
            pickup: pu,
            stops,
            rideType: selected,
            distanceKm: distanceLabel,
            quotedPrice: quote,
            payment_method: 'card',
            eta: durationLabel,
            placedAt: new Date().toISOString(),
            priceLabel: FMT.format(quote),
            priceNum: quote,
          });
          window.location.href = payRes.redirectUrl;
          return;
        }
      } catch {
        setBookError('Network error while saving booking.');
        setBookingSubmitting(false);
        return;
      }
      setBookingSubmitting(false);
    }

    navigate('/live-tracking', {
      state: {
        mode: 'taxi',
        pickup: pu,
        stops,
        rideType: selected,
        distanceKm: distanceLabel,
        quotedPrice: quote,
        taxiBookingId,
        bookingStorageTable: storageTable,
        payment_method: paymentMethod,
      },
    });
  };

  const activePayment = ridePaymentMethods.find((m) => m.id === paymentMethod);
  const paymentSubtitle =
    selectedQuote != null && activePayment
      ? `${activePayment.label} (${FMT.format(selectedQuote)})`
      : activePayment?.label ?? 'Select payment';

  const pickupDisplay =
    pickup.trim() || (live.hasFix && !pickup.trim() ? 'Current location' : '');

  const rideTiers = isTukOnly ? [{ id: 'tuktuk', label: TUK_ONLY_META.label, passengers: TUK_ONLY_META.passengers }] : RIDE_TYPES;

  return (
    <form id="br-ride-form" className="br-page" onSubmit={onBook}>
      <header className="br-nav">
        <Link to="/home" className="br-nav__back" aria-label="Back to home">
          <BackArrow />
        </Link>
        <h1 className="br-nav__title">Ride</h1>
        <span className="br-nav__spacer" aria-hidden />
      </header>

      <div className="br-scroll">
        <section className="br-tiers" aria-label="Ride type">
          <div className="br-tiers__row" role="radiogroup" aria-label="Ride type">
            {rideTiers.map((tier) => {
              const isOn = selected === tier.id;
              const Ic = ICONS[tier.id];
              return (
                <button
                  key={tier.id}
                  type="button"
                  className={isOn ? 'br-tier br-tier--active' : 'br-tier'}
                  onClick={() => setSelected(tier.id)}
                  role="radio"
                  aria-checked={isOn}
                >
                  <span className="br-tier__icon">
                    {Ic ? <Ic /> : isTukOnly ? <IconTuk /> : null}
                  </span>
                  <span className="br-tier__label">{tier.label}</span>
                  {tier.passengers ? (
                    <span className="br-tier__sub">{tier.passengers}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <div className="br-map-wrap">
          <div
            className={`br-map${useRideInteractiveMap || rideMapSrc ? ' br-map--gmap' : ''}`}
            role="img"
            aria-label="Map with pickup and destination route"
          >
            {useRideInteractiveMap ? (
              <LiveUserGoogleMap
                mapCenter={rideInteractiveMapCenter}
                fallbackCenter={LONDON_CENTER}
                hasFix={live.hasFix}
                accurate={live.hasFix}
                accuracyM={live.accuracy}
                onLoadError={() => setRideJsMapFailed(true)}
                zoomWithFix={15}
                zoomFallback={12}
                showUserLocationMarker={!hasPickupAndDestination}
              />
            ) : (
              <>
                <GoogleMapEmbed src={rideMapSrc} title="Ride route preview" />
                <LiveUserMapPuck
                  headingDeg={live.headingDeg}
                  accurate={live.hasFix}
                  visible={
                    !hasPickupAndDestination && (live.hasFix || live.geoError !== 'denied')
                  }
                  className="live-puck--inMap"
                />
              </>
            )}
          </div>
        </div>

        <LocationPermissionPrompt live={live} placement="flow" />

        <div className="br-loc-card">
          <div className="br-loc-list">
            <div className="br-loc-row flow-field--addrSuggest">
              <span className="br-loc-row__dot br-loc-row__dot--pickup" aria-hidden />
              <div className="br-loc-row__main">
                <span className="br-loc-row__label">Pickup location</span>
                <div className="br-loc-row__input">
                  <AddressSuggestInput
                    id="taxi-pickup"
                    name="pickup"
                    value={pickup}
                    onChange={(v) => {
                      setGpsNotice('');
                      setPickup(v);
                    }}
                    placeholder={pickupDisplay || 'Current location'}
                    autoComplete="street-address"
                    ariaLabel="Pickup address"
                    inline
                  />
                </div>
                <button
                  type="button"
                  className="br-loc-gps"
                  onClick={useGps}
                  disabled={gpsLoading}
                  aria-busy={gpsLoading}
                >
                  <GpsIcon />
                  {gpsLoading ? 'Finding address…' : 'Use current location'}
                </button>
                {gpsNotice ? (
                  <p className="br-geo-notice" role="alert">
                    {gpsNotice}
                  </p>
                ) : null}
              </div>
              <span className="br-loc-row__chev" aria-hidden>
                <IconChevron />
              </span>
            </div>

            <div className="br-loc-row flow-field--addrSuggest">
              <span className="br-loc-row__dot br-loc-row__dot--drop" aria-hidden />
              <div className="br-loc-row__main">
                <span className="br-loc-row__label">Drop-off location</span>
                <div className="br-loc-row__input">
                  <AddressSuggestInput
                    id="taxi-destination"
                    name="destination"
                    value={stops[0]?.value ?? ''}
                    onChange={(v) => setDropoff(v)}
                    placeholder="Enter drop-off location"
                    autoComplete="off"
                    ariaLabel="Destination address"
                    inline
                  />
                </div>
              </div>
              <span className="br-loc-row__chev" aria-hidden>
                <IconChevron />
              </span>
            </div>
          </div>
        </div>

        <div className="br-options">
          <button
            type="button"
            className="br-opt"
            aria-expanded={showPaymentPanel}
            onClick={() => setShowPaymentPanel((s) => !s)}
          >
            <span className="br-opt__icon" aria-hidden>
              <IconWalletOpt />
            </span>
            <span className="br-opt__body">
              <span className="br-opt__label">Payment method</span>
              <span className="br-opt__sub">{paymentSubtitle}</span>
            </span>
            <span className="br-opt__chev" aria-hidden>
              <IconChevron />
            </span>
          </button>
          {showPaymentPanel ? (
            <div className="br-pay-panel">
              <div className="pay-list" role="radiogroup" aria-label="Choose payment method">
                {ridePaymentMethods.map((m) => {
                  const isOn = paymentMethod === m.id;
                  const I = m.Icon;
                  return (
                    <label
                      key={m.id}
                      className={`pay-row${isOn ? ' pay-row--on' : ''}`}
                      htmlFor={`ride-pay-${m.id}`}
                    >
                      <span className="pay-row__icon" aria-hidden>
                        <I />
                      </span>
                      <span className="pay-row__body">
                        <span className="pay-row__label">{m.label}</span>
                      </span>
                      <input
                        type="radio"
                        id={`ride-pay-${m.id}`}
                        name="ride-payment"
                        className="pay-row__radio"
                        checked={isOn}
                        onChange={() => setPaymentMethod(m.id)}
                        disabled={bookingSubmitting}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <section className="br-fare" aria-label="Estimated fare">
          <div className="br-fare__top">
            <span className="br-fare__lab">Estimated fare</span>
            <span className="br-fare__amt">
              {selectedQuote != null ? FMT.format(selectedQuote) : estimateLoading ? '…' : '—'}
            </span>
          </div>
          <button
            type="button"
            className="br-fare__details-btn"
            aria-expanded={showFareDetails}
            onClick={() => setShowFareDetails((s) => !s)}
          >
            View details {showFareDetails ? '∧' : '∨'}
          </button>
          {showFareDetails ? (
            <div className="br-fare__meta">
              <div className="br-fare__meta-cell">
                <span className="br-fare__meta-lab">Distance</span>
                <span className="br-fare__meta-val">{distanceLabel}</span>
              </div>
              <div className="br-fare__meta-cell">
                <span className="br-fare__meta-lab">Duration</span>
                <span className="br-fare__meta-val">{durationLabel}</span>
              </div>
              <div className="br-fare__meta-cell">
                <span className="br-fare__meta-lab">Vehicle</span>
                <span className="br-fare__meta-val">
                  {rideTiers.find((t) => t.id === selected)?.label ?? '—'}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        {bookError ? (
          <p className="br-error" role="alert">
            {bookError}
          </p>
        ) : null}
      </div>

      <div className="br-footer">
        <button type="submit" className="br-confirm" disabled={bookingSubmitting}>
          {bookingSubmitting ? 'Saving…' : 'Confirm Ride'}
        </button>
      </div>
    </form>
  );
}
