import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  geolocationFailureMessage,
  pickupLineFromCoords,
} from '../lib/devicePickupLocation';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { estimateRoadKm, haversineKm } from '../lib/routeEstimate';
import AddressSuggestInput from '../components/AddressSuggestInput';
import './bookRide.css';

const LONDON_CENTER = { lat: 51.5074, lng: -0.1278 };

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

function IconChevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9.5 7.5L14 12l-4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDeliverBag() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="8" width="14" height="12" rx="2" fill="#EC6C23" fillOpacity="0.15" stroke="#EC6C23" strokeWidth="1.6" />
      <path d="M8 8V6a4 4 0 0 1 8 0v2" stroke="#EC6C23" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
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

export default function RequestDeliveryPage() {
  const navigate = useNavigate();
  const live = useLiveLocation({ mapThrottleMs: 4000 });
  const hasMapsKey = Boolean(getGoogleMapsApiKey());
  const [deliveryJsMapFailed, setDeliveryJsMapFailed] = useState(false);
  const [pickup, setPickup] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsNotice, setGpsNotice] = useState('');
  const [stops, setStops] = useState([createStop()]);

  const setAt = (i, v) => {
    setStops((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], value: v };
      return next;
    });
  };

  const [routeDistanceKm, setRouteDistanceKm] = useState(null);

  const onContinue = async (e) => {
    e.preventDefault();
    const p = pickup.trim();
    const stopTexts = stops.map((s) => String(s?.value ?? '').trim()).filter(Boolean);
    const drop = stopTexts[stopTexts.length - 1] || '';
    let km = routeDistanceKm;
    if (km == null && p && drop) {
      try {
        const pickupGeo = await forwardGeocodeAddress(p);
        const destGeo = await forwardGeocodeAddress(drop);
        const middleTexts = stopTexts.length > 1 ? stopTexts.slice(0, -1) : [];
        if (pickupGeo && destGeo) {
          let straight = 0;
          let prev = { lat: pickupGeo.lat, lng: pickupGeo.lng };
          for (const t of middleTexts) {
            const wp = await forwardGeocodeAddress(t);
            if (!wp) {
              straight = null;
              break;
            }
            const h = haversineKm(prev.lat, prev.lng, wp.lat, wp.lng);
            if (h == null) {
              straight = null;
              break;
            }
            straight += h;
            prev = { lat: wp.lat, lng: wp.lng };
          }
          if (straight != null) {
            const hLast = haversineKm(prev.lat, prev.lng, destGeo.lat, destGeo.lng);
            if (hLast != null) straight += hLast;
            else straight = null;
          }
          if (straight != null) {
            const road = estimateRoadKm(straight);
            if (road != null) km = road;
          }
        }
      } catch {
        /* keep km null */
      }
    }
    const distanceKm =
      km != null && Number.isFinite(km) && km > 0 ? Math.round(km * 100) / 100 : 4.2;
    navigate('/package-details', {
      state: { pickup, stops, distanceKm },
    });
  };

  const debouncedPickup = useDebouncedValue(pickup.trim(), 320);
  const debouncedStops = useDebouncedValue(stops, 320);

  const [coordsRouteSrc, setCoordsRouteSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    const p = debouncedPickup.trim();
    const stopTexts = debouncedStops.map((s) => (s?.value ?? '').trim()).filter(Boolean);
    if (!p || stopTexts.length < 1) {
      setCoordsRouteSrc('');
      setRouteDistanceKm(null);
      return undefined;
    }

    const destinationText = stopTexts[stopTexts.length - 1];
    const middleTexts = stopTexts.length > 1 ? stopTexts.slice(0, -1) : [];

    (async () => {
      try {
        const pickupGeo = await forwardGeocodeAddress(p);
        const destGeo = await forwardGeocodeAddress(destinationText);
        if (cancelled || !pickupGeo || !destGeo) {
          if (!cancelled) {
            setCoordsRouteSrc('');
            setRouteDistanceKm(null);
          }
          return;
        }

        let waypointPairs = [];
        if (middleTexts.length) {
          const midGeos = await Promise.all(middleTexts.map((t) => forwardGeocodeAddress(t)));
          waypointPairs = midGeos.filter(Boolean).map((g) => [g.lat, g.lng]);
        }

        let straight = 0;
        let prev = { lat: pickupGeo.lat, lng: pickupGeo.lng };
        for (const pair of waypointPairs) {
          const h = haversineKm(prev.lat, prev.lng, pair[0], pair[1]);
          if (h == null) {
            straight = null;
            break;
          }
          straight += h;
          prev = { lat: pair[0], lng: pair[1] };
        }
        if (straight != null) {
          const hLast = haversineKm(prev.lat, prev.lng, destGeo.lat, destGeo.lng);
          if (hLast != null) straight += hLast;
          else straight = null;
        }
        const roadKm = straight != null ? estimateRoadKm(straight) : null;
        if (!cancelled) setRouteDistanceKm(roadKm != null && roadKm > 0 ? roadKm : null);

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
          setRouteDistanceKm(null);
        }
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

  const requestMapSrc = coordsRouteSrc || textFallbackMapSrc;

  const hasPickupAndDropoff =
    pickup.trim().length > 0 && (stops[0]?.value ?? '').trim().length > 0;

  const deliveryInteractiveMapCenter = useMemo(() => {
    if (live.hasFix && live.lat != null && live.lng != null) {
      return { lat: live.lat, lng: live.lng };
    }
    return live.mapCenter;
  }, [live.hasFix, live.lat, live.lng, live.mapCenter]);

  const useDeliveryInteractiveMap = hasMapsKey && !deliveryJsMapFailed && !coordsRouteSrc;

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

  const distanceLabel =
    routeDistanceKm != null && Number.isFinite(routeDistanceKm)
      ? `${routeDistanceKm.toFixed(1)} km`
      : '—';

  return (
    <form id="rd-delivery-form" className="br-page" onSubmit={onContinue}>
      <header className="br-nav">
        <Link to="/home" className="br-nav__back" aria-label="Back to home">
          <BackArrow />
        </Link>
        <h1 className="br-nav__title">Delivery</h1>
        <span className="br-nav__spacer" aria-hidden />
      </header>

      <div className="br-scroll">
        <section className="br-tiers br-tiers--delivery" aria-label="Delivery service">
          <div className="br-delivery-hero">
            <span className="br-delivery-hero__icon" aria-hidden>
              <IconDeliverBag />
            </span>
            <div className="br-delivery-hero__text">
              <p className="br-delivery-hero__title">Send a package</p>
              <p className="br-delivery-hero__sub">Fast, reliable deliveries across town</p>
            </div>
          </div>
        </section>

        <div className="br-map-wrap">
          <div
            className={`br-map${useDeliveryInteractiveMap || requestMapSrc ? ' br-map--gmap' : ''}`}
            role="img"
            aria-label="Map with pickup and dropoff route"
          >
            {useDeliveryInteractiveMap ? (
              <LiveUserGoogleMap
                mapCenter={deliveryInteractiveMapCenter}
                fallbackCenter={LONDON_CENTER}
                hasFix={live.hasFix}
                accurate={live.hasFix}
                accuracyM={live.accuracy}
                onLoadError={() => setDeliveryJsMapFailed(true)}
                zoomWithFix={15}
                zoomFallback={12}
                showUserLocationMarker={!hasPickupAndDropoff}
              />
            ) : (
              <>
                <GoogleMapEmbed src={requestMapSrc} title="Delivery route preview" />
                <LiveUserMapPuck
                  headingDeg={live.headingDeg}
                  accurate={live.hasFix}
                  visible={
                    !hasPickupAndDropoff && (live.hasFix || live.geoError !== 'denied')
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
                    id="flow-pickup"
                    name="pickup"
                    value={pickup}
                    onChange={(v) => {
                      setGpsNotice('');
                      setPickup(v);
                    }}
                    placeholder={pickup.trim() || (live.hasFix ? 'Current location' : 'Enter pickup address')}
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
                    id="flow-dropoff"
                    name="dropoff"
                    value={stops[0]?.value ?? ''}
                    onChange={(v) => setAt(0, v)}
                    placeholder="Enter drop-off location"
                    autoComplete="off"
                    ariaLabel="Drop-off address"
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

        <section className="br-fare" aria-label="Route distance">
          <div className="br-fare__top">
            <span className="br-fare__lab">Estimated distance</span>
            <span className="br-fare__amt">{distanceLabel}</span>
          </div>
          <p className="br-delivery-hint">Fare and package options on the next step.</p>
        </section>
      </div>

      <div className="br-footer">
        <button type="submit" className="br-confirm">
          Continue
        </button>
      </div>
    </form>
  );
}
