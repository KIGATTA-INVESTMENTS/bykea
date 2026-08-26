import { useCallback, useEffect, useRef, useState } from 'react';
import { loadGoogleMapsJs, GM_AUTH_EVENT, bindGoogleMapResize, clearGoogleMapElement } from '../lib/loadGoogleMapsJs';
import {
  getGoogleMapsApiKey,
  isInServiceArea,
  isReliableGpsLatLng,
} from '../lib/googleMapsConfig';
import { haversineKm, estimateDriveMinutes } from '../lib/routeEstimate';
import './LiveTrackingRouteMap.css';

const ROUTE_STROKE = '#07408f';
const ROUTE_UPCOMING_STROKE = '#94a3b8';
const DIRECTIONS_MIN_INTERVAL_MS = 22000;
const DIRECTIONS_MIN_MOVE_KM = 0.15;

/**
 * @param {number | null | undefined} min
 */
export function formatNavEtaMinutes(min) {
  const n = Number(min);
  if (!Number.isFinite(n) || n <= 0) return 'Arriving soon';
  if (n < 1) return '< 1 min';
  return `${Math.ceil(n)} min`;
}

/**
 * @param {number | null | undefined} km
 */
export function formatNavDistanceKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1) return `${Math.max(50, Math.round(n * 1000))} m`;
  return `${n.toFixed(1)} km`;
}

function makePinIcon(google, color, scale = 9) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 2,
    scale,
  };
}

function driverPinIcon(google) {
  return {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z',
    fillColor: '#07408f',
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 1.5,
    scale: 1.35,
    anchor: new google.maps.Point(12, 22),
  };
}

/**
 * Live navigation-style map: full route, driver position, remaining time + distance.
 *
 * @param {{
 *   pickupGeo?: { lat: number, lng: number } | null,
 *   dropoffGeo?: { lat: number, lng: number } | null,
 *   driverLat?: number | null,
 *   driverLng?: number | null,
 *   driverLiveOk?: boolean,
 *   navLeg?: 'to_pickup' | 'to_dropoff',
 *   hasDriver?: boolean,
 *   onNavStats?: (stats: { etaLabel: string, distanceLabel: string, minutes: number | null, km: number | null } | null) => void,
 *   onLoadError?: () => void,
 *   className?: string,
 * }} props
 */
export default function LiveTrackingRouteMap({
  pickupGeo,
  dropoffGeo,
  driverLat,
  driverLng,
  driverLiveOk = false,
  navLeg = 'to_pickup',
  hasDriver = false,
  onNavStats,
  onLoadError,
  className = '',
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const activeRendererRef = useRef(null);
  const upcomingRendererRef = useRef(null);
  const fallbackLinesRef = useRef({ active: null, upcoming: null });
  const markersRef = useRef({ pickup: null, dropoff: null, driver: null });
  const lastDirectionsAtRef = useRef(0);
  const lastDirectionsOriginRef = useRef(null);
  const lastNavLegRef = useRef(null);
  const directionsDeniedRef = useRef(false);
  const userMovedRef = useRef(false);
  const fitKeyRef = useRef('');
  const lastPanAtRef = useRef(0);
  const blockedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [overlay, setOverlay] = useState(null);

  const onNavStatsRef = useRef(onNavStats);
  onNavStatsRef.current = onNavStats;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  const signalBlocked = useCallback(() => {
    if (blockedRef.current) return;
    blockedRef.current = true;
    onLoadErrorRef.current?.();
  }, []);

  const clearRenderers = useCallback(() => {
    activeRendererRef.current?.setMap(null);
    upcomingRendererRef.current?.setMap(null);
    activeRendererRef.current = null;
    upcomingRendererRef.current = null;
    fallbackLinesRef.current.active?.setMap(null);
    fallbackLinesRef.current.upcoming?.setMap(null);
    fallbackLinesRef.current.active = null;
    fallbackLinesRef.current.upcoming = null;
  }, []);

  const drawFallbackLine = useCallback((key, origin, destination, strokeColor, strokeWeight, strokeOpacity) => {
    const map = mapRef.current;
    const G = window.google;
    if (!map || !G?.maps || !origin || !destination) return;
    const path = [origin, destination];
    if (!fallbackLinesRef.current[key]) {
      fallbackLinesRef.current[key] = new G.maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor,
        strokeOpacity,
        strokeWeight,
        zIndex: key === 'active' ? 15 : 10,
      });
    } else {
      fallbackLinesRef.current[key].setPath(path);
      fallbackLinesRef.current[key].setMap(map);
      fallbackLinesRef.current[key].setOptions({ strokeColor, strokeOpacity, strokeWeight });
    }
  }, []);

  const clearMarkers = useCallback(() => {
    for (const key of Object.keys(markersRef.current)) {
      markersRef.current[key]?.setMap(null);
      markersRef.current[key] = null;
    }
  }, []);

  const updateMarker = useCallback((key, pos, icon) => {
    const map = mapRef.current;
    const G = window.google;
    if (!map || !G?.maps || !pos) {
      markersRef.current[key]?.setMap(null);
      markersRef.current[key] = null;
      return;
    }
    if (!markersRef.current[key]) {
      markersRef.current[key] = new G.maps.Marker({ map, position: pos, icon, zIndex: key === 'driver' ? 30 : 20 });
    } else {
      markersRef.current[key].setPosition(pos);
      markersRef.current[key].setMap(map);
      if (icon) markersRef.current[key].setIcon(icon);
    }
  }, []);

  const publishStats = useCallback((minutes, km) => {
    const etaLabel = formatNavEtaMinutes(minutes);
    const distanceLabel = formatNavDistanceKm(km);
    const stats = { etaLabel, distanceLabel, minutes, km };
    setOverlay(stats);
    onNavStatsRef.current?.(stats);
  }, []);

  const requestRoute = useCallback(
    (origin, destination, renderer, strokeColor, strokeWeight, strokeOpacity) => {
      const map = mapRef.current;
      const service = directionsServiceRef.current;
      const G = window.google;
      if (!map || !service || !G?.maps || !origin || !destination) return Promise.resolve(null);

      return new Promise((resolve) => {
        service.route(
          {
            origin,
            destination,
            travelMode: G.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status !== 'OK' || !result) {
              if (status === 'REQUEST_DENIED' || status === 'OVER_QUERY_LIMIT') {
                if (!directionsDeniedRef.current) {
                  directionsDeniedRef.current = true;
                  console.warn(
                    `[LiveTrackingRouteMap] Directions API ${status} — enable "Directions API" for your Google Maps key to show the road route. Showing a direct line for now.`,
                  );
                }
              }
              resolve({ renderer: null, result: null, status });
              return;
            }
            if (!renderer) {
              renderer = new G.maps.DirectionsRenderer({
                map,
                suppressMarkers: true,
                preserveViewport: true,
                polylineOptions: { strokeColor, strokeWeight, strokeOpacity },
              });
            } else {
              renderer.setMap(map);
              renderer.setOptions({
                suppressMarkers: true,
                preserveViewport: true,
                polylineOptions: { strokeColor, strokeWeight, strokeOpacity },
              });
            }
            renderer.setDirections(result);
            resolve({ renderer, result, status });
          },
        );
      });
    },
    [],
  );

  const fitMapToPoints = useCallback((points) => {
    const map = mapRef.current;
    const G = window.google;
    if (!map || !G?.maps || !points.length) return;
    const bounds = new G.maps.LatLngBounds();
    for (const p of points) bounds.extend(p);
    map.fitBounds(bounds, { top: 48, right: 36, bottom: 72, left: 36 });
  }, []);

  const shouldRefreshDirections = useCallback((origin) => {
    const now = Date.now();
    if (now - lastDirectionsAtRef.current < DIRECTIONS_MIN_INTERVAL_MS) {
      const prev = lastDirectionsOriginRef.current;
      if (prev && origin) {
        const moved = haversineKm(prev.lat, prev.lng, origin.lat, origin.lng);
        if (moved != null && moved < DIRECTIONS_MIN_MOVE_KM) return false;
      } else {
        return false;
      }
    }
    return true;
  }, []);

  const drawRoutes = useCallback(async () => {
    const map = mapRef.current;
    const G = window.google;
    if (!mapReady || !map || !G?.maps) return;

    const pickup =
      pickupGeo && Number.isFinite(pickupGeo.lat) && Number.isFinite(pickupGeo.lng)
        ? { lat: pickupGeo.lat, lng: pickupGeo.lng }
        : null;
    const dropoff =
      dropoffGeo && Number.isFinite(dropoffGeo.lat) && Number.isFinite(dropoffGeo.lng)
        ? { lat: dropoffGeo.lat, lng: dropoffGeo.lng }
        : null;

    const driverOk =
      driverLiveOk &&
      isReliableGpsLatLng(driverLat, driverLng) &&
      isInServiceArea(driverLat, driverLng);
    const driver = driverOk ? { lat: Number(driverLat), lng: Number(driverLng) } : null;

    if (pickup) updateMarker('pickup', pickup, makePinIcon(G, '#F18631', 8));
    else markersRef.current.pickup?.setMap(null);

    if (dropoff) updateMarker('dropoff', dropoff, makePinIcon(G, '#e53935', 8));
    else markersRef.current.dropoff?.setMap(null);

    if (driver) updateMarker('driver', driver, driverPinIcon(G));
    else markersRef.current.driver?.setMap(null);

    const toDropoff = navLeg === 'to_dropoff';
    const activeDest = toDropoff ? dropoff : pickup;
    const fitPts = [pickup, dropoff, driver].filter(Boolean);

    let activeMinutes = null;
    let activeKm = null;

    if (hasDriver && driver && activeDest) {
      const legChanged = lastNavLegRef.current !== navLeg;
      if (legChanged) {
        lastNavLegRef.current = navLeg;
        lastDirectionsAtRef.current = 0;
        clearRenderers();
      }
      const refresh = legChanged || shouldRefreshDirections(driver);
      if (refresh) {
        clearRenderers();
        const active = await requestRoute(
          driver,
          activeDest,
          activeRendererRef.current,
          ROUTE_STROKE,
          6,
          0.92,
        );
        if (active?.renderer) activeRendererRef.current = active.renderer;
        if (active?.result?.routes?.[0]?.legs?.[0]) {
          const leg = active.result.routes[0].legs[0];
          activeKm = leg.distance?.value != null ? leg.distance.value / 1000 : null;
          activeMinutes = leg.duration?.value != null ? leg.duration.value / 60 : null;
          lastDirectionsAtRef.current = Date.now();
          lastDirectionsOriginRef.current = { ...driver };
        } else {
          drawFallbackLine('active', driver, activeDest, ROUTE_STROKE, 5, 0.9);
        }

        if (!toDropoff && pickup && dropoff) {
          const upcoming = await requestRoute(
            pickup,
            dropoff,
            upcomingRendererRef.current,
            ROUTE_UPCOMING_STROKE,
            4,
            0.45,
          );
          if (upcoming?.renderer) upcomingRendererRef.current = upcoming.renderer;
          else drawFallbackLine('upcoming', pickup, dropoff, ROUTE_UPCOMING_STROKE, 4, 0.45);
        }
      }

      if (activeKm == null && driver && activeDest) {
        activeKm = haversineKm(driver.lat, driver.lng, activeDest.lat, activeDest.lng);
        activeKm = activeKm != null ? activeKm * 1.28 : null;
        activeMinutes = estimateDriveMinutes(activeKm);
      }

      publishStats(activeMinutes, activeKm);
    } else if (pickup && dropoff) {
      clearRenderers();
      const full = await requestRoute(pickup, dropoff, activeRendererRef.current, ROUTE_STROKE, 5, 0.88);
      if (full?.renderer) activeRendererRef.current = full.renderer;
      else drawFallbackLine('active', pickup, dropoff, ROUTE_STROKE, 5, 0.88);
      const leg = full?.result?.routes?.[0]?.legs?.[0];
      const straight = haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      const km = leg?.distance?.value != null ? leg.distance.value / 1000 : straight != null ? straight * 1.28 : null;
      const minutes = leg?.duration?.value != null ? leg.duration.value / 60 : estimateDriveMinutes(km);
      publishStats(minutes, km);
    } else if (pickup || dropoff) {
      publishStats(null, null);
    } else {
      setOverlay(null);
      onNavStatsRef.current?.(null);
    }

    if (fitPts.length) {
      const fitKey = [
        pickup ? `${pickup.lat.toFixed(5)},${pickup.lng.toFixed(5)}` : '',
        dropoff ? `${dropoff.lat.toFixed(5)},${dropoff.lng.toFixed(5)}` : '',
        navLeg,
        hasDriver ? '1' : '0',
      ].join('|');
      if (fitKey !== fitKeyRef.current) {
        fitKeyRef.current = fitKey;
        userMovedRef.current = false;
        fitMapToPoints(fitPts);
      } else if (driver && !userMovedRef.current) {
        const now = Date.now();
        if (now - lastPanAtRef.current > 4000) {
          lastPanAtRef.current = now;
          map.panTo(driver);
        }
      }
    }
  }, [
    mapReady,
    pickupGeo,
    dropoffGeo,
    driverLat,
    driverLng,
    driverLiveOk,
    navLeg,
    hasDriver,
    clearRenderers,
    drawFallbackLine,
    updateMarker,
    requestRoute,
    fitMapToPoints,
    shouldRefreshDirections,
    publishStats,
  ]);

  useEffect(() => {
    const el = elRef.current;
    if (!el || !getGoogleMapsApiKey()) {
      signalBlocked();
      return undefined;
    }

    let cancelled = false;
    let unbindResize = () => {};
    blockedRef.current = false;

    const onGmAuth = () => {
      if (!cancelled) signalBlocked();
    };
    window.addEventListener(GM_AUTH_EVENT, onGmAuth);

    loadGoogleMapsJs(['routes'])
      .then((google) => {
        if (cancelled || !el.isConnected) return;
        clearGoogleMapElement(el);
        const center = pickupGeo || dropoffGeo || { lat: -17.8292, lng: 31.0522 };
        const map = new google.maps.Map(el, {
          center,
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: google.maps.ControlPosition.RIGHT_TOP,
          },
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: false,
        });
        if (cancelled) {
          clearGoogleMapElement(el);
          return;
        }
        map.addListener('dragstart', () => {
          userMovedRef.current = true;
        });
        mapRef.current = map;
        try {
          directionsServiceRef.current = new google.maps.DirectionsService();
        } catch (err) {
          console.warn('[LiveTrackingRouteMap] DirectionsService unavailable', err);
          directionsServiceRef.current = null;
        }
        unbindResize = bindGoogleMapResize(map, el);
        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) signalBlocked();
      });

    return () => {
      cancelled = true;
      unbindResize();
      window.removeEventListener(GM_AUTH_EVENT, onGmAuth);
      clearRenderers();
      clearMarkers();
      mapRef.current = null;
      directionsServiceRef.current = null;
      clearGoogleMapElement(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [signalBlocked, clearRenderers, clearMarkers]);

  useEffect(() => {
    void drawRoutes();
  }, [drawRoutes]);

  const rootClass = ['lt-route-map', className].filter(Boolean).join(' ');
  const showOverlay = overlay && (overlay.etaLabel || overlay.distanceLabel);

  return (
    <div className={rootClass}>
      <div ref={elRef} className="lt-route-map__canvas" role="presentation" aria-hidden={!mapReady} />
      {showOverlay ? (
        <div className="lt-route-map__hud" aria-live="polite">
          <div className="lt-route-map__hud-main">
            <span className="lt-route-map__hud-eta">{overlay.etaLabel}</span>
            {overlay.distanceLabel ? (
              <span className="lt-route-map__hud-dist">{overlay.distanceLabel} away</span>
            ) : null}
          </div>
          <span className="lt-route-map__hud-leg">
            {hasDriver
              ? navLeg === 'to_dropoff'
                ? 'To delivery'
                : 'To pickup'
              : 'Full route'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
