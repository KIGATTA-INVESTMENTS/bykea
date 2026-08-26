import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { deliveryOrderDisplayRef } from '../lib/customerDeliveryOrderPayload';
import { notifyDriversOfNewOffer } from '../lib/driverOfferPushNotify';
import { postEcocashCharge } from '../lib/ecocashLocal';
import { friendlyAppUserFkError, getCustomerSession, resolveValidAppUserId } from '../lib/customerSession';
import { debitCustomerWallet, fetchCustomerWalletBalance } from '../lib/customerWallet';
import {
  computeIngoKilometreFare,
  resolveIngoVehicleFromRide,
} from '../lib/ingoKilometres';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import BikeIcon from '../components/icons/BikeIcon';
import CarIcon from '../components/icons/CarIcon';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import LiveUserGoogleMap from '../components/LiveUserGoogleMap';
import LocationPermissionPrompt from '../components/LocationPermissionPrompt';
import LiveUserMapPuck from '../components/LiveUserMapPuck';
import { useLiveLocation } from '../hooks/useLiveLocation';
import {
  DEFAULT_MAP_FALLBACK,
  getGoogleMapsApiKey,
  publicDirectionsCoordsMapUrl,
  publicPlaceMapUrl,
  publicViewMapUrl,
  trustedMapCenter,
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

function IconStripeRide() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <rect x="3" y="7" width="26" height="18" rx="2" fill="#635bff" />
      <path d="M3 12h26" fill="#0a2540" opacity="0.25" />
      <rect x="6" y="17" width="10" height="3" rx="0.5" fill="#c4f4ff" opacity="0.9" />
    </svg>
  );
}
function IconIngoKmRide() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" aria-hidden>
      <rect x="4" y="8" width="24" height="16" rx="2.5" stroke="#0A58A6" strokeWidth="1.8" fill="#e8f1fb" />
      <path d="M4 13h24" stroke="#0A58A6" strokeWidth="1.5" />
      <circle cx="22" cy="18.5" r="1.6" fill="#F18631" />
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
  taxi: { base_fare: 3, price_per_km: 1.2, price_per_minute: 0.15, service_fee: 0.5 },
  tuk_tuk: { base_fare: 2, price_per_km: 0.8, price_per_minute: 0.1, service_fee: 0.35 },
};

function billableMinutes(durationMins) {
  if (durationMins == null || !Number.isFinite(durationMins) || durationMins <= 0) return 0;
  return Math.max(1, Math.round(durationMins));
}

function computeRideQuote(roadKm, durationMins, rates, rideId, isTukOnlyPage) {
  if (roadKm == null || !Number.isFinite(roadKm) || roadKm <= 0 || !rates) return null;
  const eff = effectiveBillableKm(roadKm, 0.5);
  const mins = billableMinutes(durationMins);
  const timeFee = mins * Number(rates.price_per_minute || 0);
  const raw =
    Number(rates.base_fare) + eff * Number(rates.price_per_km) + timeFee + Number(rates.service_fee);
  if (!Number.isFinite(raw)) return null;
  const mult = isTukOnlyPage ? 1 : TIER_MULT[rideId] ?? TIER_MULT.car;
  return Math.round(raw * mult * 100) / 100;
}

function computeRideQuoteBreakdown(roadKm, durationMins, rates, rideId, isTukOnlyPage) {
  if (!rates || roadKm == null || !Number.isFinite(roadKm) || roadKm <= 0) return null;
  const eff = effectiveBillableKm(roadKm, 0.5);
  const mins = billableMinutes(durationMins);
  const mult = isTukOnlyPage ? 1 : TIER_MULT[rideId] ?? TIER_MULT.car;
  const base = Number(rates.base_fare) * mult;
  const distance = eff * Number(rates.price_per_km) * mult;
  const time = mins * Number(rates.price_per_minute || 0) * mult;
  const service = Number(rates.service_fee) * mult;
  const total = Math.round((base + distance + time + service) * 100) / 100;
  return { base, distance, time, service, mins, total };
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
  const [pickupCoords, setPickupCoords] = useState(null);
  const [dropoffCoords, setDropoffCoords] = useState(null);
  const [pinBusy, setPinBusy] = useState('');
  const skipGeocodeFromDragRef = useRef(false);
  const [bookError, setBookError] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const showRideStripe = useMemo(() => isStripePaymentsConfigured(), []);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [ecoPhone, setEcoPhone] = useState(() => String(getCustomerSession()?.phone || '').trim());
  const [showFareDetails, setShowFareDetails] = useState(false);
  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  const ingoVehicle = useMemo(
    () => resolveIngoVehicleFromRide(selected, isTukOnly),
    [selected, isTukOnly],
  );
  const walletEligible = Boolean(ingoVehicle);

  const ridePaymentMethods = useMemo(() => {
    const rows = [
      { id: 'cod', label: 'Cash on delivery', Icon: IconCashRide },
      { id: 'ecocash', label: 'EcoCash', Icon: IconCashRide },
    ];
    if (walletEligible) {
      rows.push({ id: 'wallet', label: 'Ingo Kilometres', Icon: IconIngoKmRide });
    }
    if (showRideStripe) rows.push({ id: 'stripe', label: 'Card', Icon: IconStripeRide });
    return rows;
  }, [showRideStripe, walletEligible]);

  useEffect(() => {
    if (paymentMethod === 'wallet' && !walletEligible) setPaymentMethod('cod');
    if (paymentMethod === 'card') setPaymentMethod(showRideStripe ? 'stripe' : 'cod');
    if (paymentMethod === 'stripe' && !showRideStripe) setPaymentMethod('cod');
  }, [paymentMethod, showRideStripe, walletEligible]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!walletEligible) {
        if (!cancelled) setWalletBalance(0);
        return;
      }
      const session = getCustomerSession();
      const { balance } = await fetchCustomerWalletBalance(session?.id || null);
      if (!cancelled) setWalletBalance(balance);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletEligible]);

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

  const marketQuote = useMemo(
    () => computeRideQuote(roadKm, durationMins, rates, selected, isTukOnly),
    [roadKm, durationMins, rates, selected, isTukOnly],
  );

  const ingoFareResult = useMemo(() => {
    if (!ingoVehicle || roadKm == null || !Number.isFinite(roadKm) || roadKm <= 0) return null;
    return computeIngoKilometreFare({ vehicle: ingoVehicle, distanceKm: roadKm });
  }, [ingoVehicle, roadKm]);

  const useIngoFare = paymentMethod === 'wallet' && ingoFareResult != null;
  const selectedQuote = useIngoFare ? ingoFareResult.fare : marketQuote;

  const fareBreakdown = useMemo(() => {
    if (useIngoFare && ingoFareResult) {
      return {
        base: ingoFareResult.minFare,
        distance: ingoFareResult.extraFare,
        time: 0,
        service: 0,
        mins: 0,
        total: ingoFareResult.fare,
        ingo: true,
        extraKm: ingoFareResult.extraKm,
      };
    }
    return computeRideQuoteBreakdown(roadKm, durationMins, rates, selected, isTukOnly);
  }, [useIngoFare, ingoFareResult, roadKm, durationMins, rates, selected, isTukOnly]);

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
        .select('price_per_km, price_per_minute, base_fare, service_fee')
        .eq('service_type', svc)
        .maybeSingle();
      if (cancelled) return;
      const pk = data?.price_per_km != null ? Number(data.price_per_km) : NaN;
      const pm = data?.price_per_minute != null ? Number(data.price_per_minute) : NaN;
      const bf = data?.base_fare != null ? Number(data.base_fare) : NaN;
      const sf = data?.service_fee != null ? Number(data.service_fee) : NaN;
      const fb = isTukOnly ? FALLBACK_RATES.tuk_tuk : FALLBACK_RATES.taxi;
      setRates({
        price_per_km: Number.isFinite(pk) && pk >= 0 ? pk : fb.price_per_km,
        price_per_minute: Number.isFinite(pm) && pm >= 0 ? pm : fb.price_per_minute,
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
      if (!p) setPickupCoords(null);
      if (!stopTexts.length) setDropoffCoords(null);
      return undefined;
    }

    if (skipGeocodeFromDragRef.current) {
      skipGeocodeFromDragRef.current = false;
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
          if (pickupGeo) setPickupCoords({ lat: pickupGeo.lat, lng: pickupGeo.lng });
          else if (!p) setPickupCoords(null);
          if (destGeo) setDropoffCoords({ lat: destGeo.lat, lng: destGeo.lng });
          setCoordsRouteSrc('');
          setRoadKm(null);
          setDurationMins(null);
          setEstimateLoading(false);
          return;
        }

        setPickupCoords({ lat: pickupGeo.lat, lng: pickupGeo.lng });
        setDropoffCoords({ lat: destGeo.lat, lng: destGeo.lng });

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
    const c = trustedMapCenter(live.mapCenter);
    return publicViewMapUrl(c.lat, c.lng, 14);
  }, [debouncedPickup, debouncedStops, live.mapCenter]);

  const rideMapSrc = coordsRouteSrc || textFallbackMapSrc;

  const hasPickupAndDestination =
    pickup.trim().length > 0 && (stops[0]?.value ?? '').trim().length > 0;

  const hasEditablePins = Boolean(pickupCoords || dropoffCoords);

  /** Same live dot as /home: raw GPS for JS map (mapCenter throttled for embed URLs). */
  const rideInteractiveMapCenter = useMemo(() => {
    if (pickupCoords) return trustedMapCenter(pickupCoords);
    if (live.hasFix && live.lat != null && live.lng != null) {
      return trustedMapCenter({ lat: live.lat, lng: live.lng });
    }
    return trustedMapCenter(live.mapCenter);
  }, [pickupCoords, live.hasFix, live.lat, live.lng, live.mapCenter]);

  const jsMapAvailable = hasMapsKey && !rideJsMapFailed;

  const useGps = async () => {
    if (gpsLoading) return;
    setGpsNotice('');
    setGpsLoading(true);
    try {
      const coords = await live.refreshFromUserGesture();
      const next = { lat: coords.latitude, lng: coords.longitude };
      setPickupCoords(next);
      skipGeocodeFromDragRef.current = true;
      const line = await pickupLineFromCoords(coords.latitude, coords.longitude);
      setPickup(line);
    } catch (err) {
      const code = typeof err?.code === 'number' ? err.code : 2;
      setGpsNotice(geolocationFailureMessage(code));
    } finally {
      setGpsLoading(false);
    }
  };

  const recomputeRideFromPins = (pu, drop) => {
    if (!pu || !drop) {
      setCoordsRouteSrc('');
      setRoadKm(null);
      setDurationMins(null);
      return;
    }
    const straight = haversineKm(pu.lat, pu.lng, drop.lat, drop.lng);
    const road = straight != null ? estimateRoadKm(straight) : null;
    if (road != null && Number.isFinite(road)) {
      setRoadKm(road);
      setDurationMins(estimateDriveMinutes(road));
    } else {
      setRoadKm(null);
      setDurationMins(null);
    }
    const url = publicDirectionsCoordsMapUrl(pu.lat, pu.lng, drop.lat, drop.lng, []);
    setCoordsRouteSrc(url || '');
  };

  const onPickupDragEnd = async (lat, lng) => {
    const next = { lat, lng };
    setPickupCoords(next);
    recomputeRideFromPins(next, dropoffCoords);
    setPinBusy('pickup');
    skipGeocodeFromDragRef.current = true;
    try {
      const line = await pickupLineFromCoords(lat, lng);
      setPickup(line);
      setGpsNotice('');
    } catch {
      setPickup(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setPinBusy('');
    }
  };

  const onDropoffDragEnd = async (lat, lng) => {
    const next = { lat, lng };
    setDropoffCoords(next);
    recomputeRideFromPins(pickupCoords, next);
    setPinBusy('dropoff');
    skipGeocodeFromDragRef.current = true;
    try {
      const line = await pickupLineFromCoords(lat, lng);
      setDropoff(line);
    } catch {
      setDropoff(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setPinBusy('');
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
    const quote = selectedQuote;
    if (quote == null || roadKm == null) {
      setBookError('Could not estimate this route yet. Wait for distance to load, or adjust addresses.');
      return;
    }

    const useWallet = paymentMethod === 'wallet' && walletEligible;
    const useStripeFirst = paymentMethod === 'stripe' && showRideStripe;
    const useEcocash = paymentMethod === 'ecocash';
    if (paymentMethod === 'stripe' && !showRideStripe) {
      setBookError(
        'Card payments need the app backend configured (Supabase and card payment keys).',
      );
      return;
    }
    if (useEcocash) {
      if (!String(ecoPhone || '').trim()) {
        setBookError('Enter the EcoCash mobile number that will approve payment.');
        return;
      }
    }
    if (useWallet) {
      if (!ingoFareResult) {
        setBookError('Ingo Kilometres is only available for bike and tuktuk rides.');
        return;
      }
      const sessionCheck = getCustomerSession();
      if (!sessionCheck?.id) {
        setBookError('Sign in to pay with Ingo Kilometres.');
        return;
      }
      if (walletBalance + 0.001 < quote) {
        setBookError(
          `Insufficient Ingo Kilometres balance (${FMT.format(walletBalance)}). Top up or choose cash.`,
        );
        return;
      }
    }
    if ((useStripeFirst || useWallet || useEcocash) && (!isSupabaseConfigured || !supabase)) {
      setBookError('Connect Supabase to pay online.');
      return;
    }

    let taxiBookingId = null;
    if (isSupabaseConfigured && supabase) {
      setBookingSubmitting(true);
      try {
        const session = getCustomerSession();
        const appUserId = await resolveValidAppUserId(supabase, session?.id);
        const rowPayload = isTukOnly
          ? {
              app_user_id: appUserId,
              pickup_location: pu,
              destination_location: dest,
              estimated_distance_label: distanceLabel,
              estimated_duration_label: durationLabel,
              quoted_price: quote,
              minimum_fare_amount: quote,
              customer_offer_amount: quote,
              bid_status: 'open',
              currency: 'USD',
              status: 'requested',
              payment_method: paymentMethod,
              ...(useWallet
                ? {
                    payment_status: 'pending',
                    payment_gateway: 'wallet',
                  }
                : {}),
            }
          : {
              app_user_id: appUserId,
              pickup_location: pu,
              destination_location: dest,
              ride_type: selected === 'tuktuk' ? 'tuk' : 'std',
              vehicle_type: selected,
              estimated_distance_label: distanceLabel,
              estimated_duration_label: durationLabel,
              quoted_price: quote,
              minimum_fare_amount: quote,
              customer_offer_amount: quote,
              bid_status: 'open',
              currency: 'USD',
              status: 'requested',
              payment_method: paymentMethod,
              ...(useWallet
                ? {
                    payment_status: 'pending',
                    payment_gateway: 'wallet',
                  }
                : {}),
            };

        let { data, error } = await supabase.from(storageTable).insert(rowPayload).select('id').single();
        if (error && /app_user_id_fkey|foreign key constraint.*app_user/i.test(error.message || '')) {
          ({ data, error } = await supabase
            .from(storageTable)
            .insert({ ...rowPayload, app_user_id: null })
            .select('id')
            .single());
        }
        if (error) {
          if (/payment_method|payment_method_chk|wallet/i.test(error.message || '')) {
            setBookError(
              `${friendlyAppUserFkError(error.message)} — Run supabase/taxi_tuk_wallet_payment.sql in the SQL editor.`,
            );
          } else {
            setBookError(friendlyAppUserFkError(error.message));
          }
          setBookingSubmitting(false);
          return;
        }
        taxiBookingId = data?.id ?? null;

        if (useWallet && taxiBookingId) {
          if (!appUserId) {
            await supabase.from(storageTable).delete().eq('id', taxiBookingId);
            setBookError('Sign in with a valid account to pay with Ingo Kilometres.');
            setBookingSubmitting(false);
            return;
          }
          const debit = await debitCustomerWallet({
            userId: appUserId,
            amount: quote,
            label: `Ride ${deliveryOrderDisplayRef(taxiBookingId)}`,
            refType: isTukOnly ? 'tuk' : 'taxi',
            refId: taxiBookingId,
          });
          if (!debit.ok) {
            await supabase.from(storageTable).delete().eq('id', taxiBookingId);
            setBookError(debit.error || 'Could not pay with Ingo Kilometres.');
            setBookingSubmitting(false);
            return;
          }
          await supabase
            .from(storageTable)
            .update({
              payment_status: 'paid',
              payment_completed_at: new Date().toISOString(),
              payment_gateway: 'wallet',
            })
            .eq('id', taxiBookingId);
          setWalletBalance(Number(debit.balanceAfter) || Math.max(0, walletBalance - quote));
        }

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

        if (useEcocash && taxiBookingId) {
          const sessionEco = getCustomerSession();
          const phoneForCharge = String(ecoPhone || sessionEco?.phone || '').trim();
          const displayRef = deliveryOrderDisplayRef(taxiBookingId);
          const charge = await postEcocashCharge({
            orderId: taxiBookingId,
            orderNumber: displayRef,
            amount: quote,
            phone: phoneForCharge,
            orderKind: isTukOnly ? 'tuk' : 'taxi',
            customerName: sessionEco?.full_name || sessionEco?.email || 'Customer',
            remarks: isTukOnly ? `Tuk-Tuk ${displayRef}` : `Taxi ${displayRef}`,
          });
          if (!charge?.ok) {
            await supabase.from(storageTable).delete().eq('id', taxiBookingId);
            setBookError(charge?.error || 'Could not start EcoCash payment.');
            setBookingSubmitting(false);
            return;
          }
          const liveState = {
            mode: 'taxi',
            pickup: pu,
            stops,
            rideType: selected,
            distanceKm: distanceLabel,
            quotedPrice: quote,
            taxiBookingId,
            bookingStorageTable: storageTable,
            payment_method: 'ecocash',
            orderId: displayRef,
            eta: durationLabel,
            priceLabel: FMT.format(quote),
            priceNum: quote,
            placedAt: new Date().toISOString(),
          };
          setBookingSubmitting(false);
          navigate('/ecocash-waiting', {
            replace: true,
            state: {
              clientCorrelation: charge.clientCorrelation,
              phone: charge.phone || ecoPhone,
              orderId: taxiBookingId,
              orderKind: isTukOnly ? 'tuk' : 'taxi',
              orderNumber: displayRef,
              notifyTable: storageTable,
              nextPath: '/live-tracking',
              nextState: liveState,
            },
          });
          return;
        }

        if (taxiBookingId) {
          notifyDriversOfNewOffer(storageTable, taxiBookingId);
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
        orderId: deliveryOrderDisplayRef(taxiBookingId),
        eta: durationLabel,
        priceLabel: FMT.format(quote),
        priceNum: quote,
        placedAt: new Date().toISOString(),
      },
    });
  };

  const activePayment = ridePaymentMethods.find((m) => m.id === paymentMethod);
  const paymentSubtitle =
    selectedQuote != null && activePayment
      ? paymentMethod === 'wallet'
        ? `${activePayment.label} (${FMT.format(selectedQuote)} · bal ${FMT.format(walletBalance)})`
        : `${activePayment.label} (${FMT.format(selectedQuote)})`
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
            className={`br-map${jsMapAvailable || rideMapSrc ? ' br-map--gmap' : ''}${
              hasEditablePins ? ' br-map--editable' : ''
            }`}
            role="region"
            aria-label="Map with pickup and destination — drag pins to adjust"
          >
            {jsMapAvailable ? (
              <div className="br-map-js-layer">
                <LiveUserGoogleMap
                  mapCenter={rideInteractiveMapCenter}
                  fallbackCenter={DEFAULT_MAP_FALLBACK}
                  hasFix={live.hasFix}
                  accurate={live.hasFix}
                  accuracyM={live.accuracy}
                  onLoadError={() => setRideJsMapFailed(true)}
                  zoomWithFix={15}
                  zoomFallback={12}
                  showUserLocationMarker={!hasEditablePins}
                  pickupPin={pickupCoords}
                  dropoffPin={dropoffCoords}
                  onPickupDragEnd={onPickupDragEnd}
                  onDropoffDragEnd={onDropoffDragEnd}
                />
                {hasEditablePins ? (
                  <span className="br-map-hint" aria-live="polite">
                    {pinBusy
                      ? 'Updating address…'
                      : 'Drag the green (pickup) or orange (drop-off) pin to fine-tune'}
                  </span>
                ) : null}
              </div>
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
                      if (!String(v || '').trim()) setPickupCoords(null);
                    }}
                    onSelectSuggestion={(s) => {
                      if (s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))) {
                        setPickupCoords({ lat: Number(s.lat), lng: Number(s.lng) });
                        skipGeocodeFromDragRef.current = true;
                      }
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
                    onChange={(v) => {
                      setDropoff(v);
                      if (!String(v || '').trim()) setDropoffCoords(null);
                    }}
                    onSelectSuggestion={(s) => {
                      if (s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))) {
                        setDropoffCoords({ lat: Number(s.lat), lng: Number(s.lng) });
                        skipGeocodeFromDragRef.current = true;
                      }
                    }}
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
              {paymentMethod === 'wallet' ? (
                <p className="br-pay-wallet-hint">
                  Balance {FMT.format(walletBalance)}. Fixed Ingo Kilometre rate — top up at{' '}
                  <Link to="/wallet/top-up">Ingo Kilometres</Link> if needed.
                </p>
              ) : null}
              {paymentMethod === 'ecocash' ? (
                <label className="br-pay-wallet-hint" style={{ display: 'block', marginTop: '0.75rem' }}>
                  <span style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>EcoCash number</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0771234567"
                    value={ecoPhone}
                    onChange={(e) => setEcoPhone(e.target.value)}
                    disabled={bookingSubmitting}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      height: 44,
                      borderRadius: 10,
                      border: '1px solid #dbe3ef',
                      padding: '0 0.85rem',
                      fontSize: '1rem',
                      fontFamily: 'inherit',
                    }}
                    required
                  />
                </label>
              ) : null}
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
              {fareBreakdown ? (
                fareBreakdown.ingo ? (
                  <>
                    <div className="br-fare__meta-cell">
                      <span className="br-fare__meta-lab">
                        Min fare (first 3 km)
                      </span>
                      <span className="br-fare__meta-val">{FMT.format(fareBreakdown.base)}</span>
                    </div>
                    <div className="br-fare__meta-cell">
                      <span className="br-fare__meta-lab">
                        Beyond 3 km ({fareBreakdown.extraKm} km × $0.60)
                      </span>
                      <span className="br-fare__meta-val">{FMT.format(fareBreakdown.distance)}</span>
                    </div>
                    <p className="br-fare__ingo-note">Ingo Kilometres fixed rate — not negotiable</p>
                  </>
                ) : (
                  <>
                    <div className="br-fare__meta-cell">
                      <span className="br-fare__meta-lab">Base fare</span>
                      <span className="br-fare__meta-val">{FMT.format(fareBreakdown.base)}</span>
                    </div>
                    <div className="br-fare__meta-cell">
                      <span className="br-fare__meta-lab">Distance fee</span>
                      <span className="br-fare__meta-val">{FMT.format(fareBreakdown.distance)}</span>
                    </div>
                    <div className="br-fare__meta-cell">
                      <span className="br-fare__meta-lab">
                        Time fee ({fareBreakdown.mins} min × {FMT.format(Number(rates.price_per_minute) || 0)}/min)
                      </span>
                      <span className="br-fare__meta-val">{FMT.format(fareBreakdown.time)}</span>
                    </div>
                    <div className="br-fare__meta-cell">
                      <span className="br-fare__meta-lab">Service fee</span>
                      <span className="br-fare__meta-val">{FMT.format(fareBreakdown.service)}</span>
                    </div>
                  </>
                )
              ) : null}
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
