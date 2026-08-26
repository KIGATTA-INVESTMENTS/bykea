import { useCallback, useEffect, useRef, useState } from 'react';
import { loadGoogleMapsJs, GM_AUTH_EVENT, bindGoogleMapResize, clearGoogleMapElement } from '../lib/loadGoogleMapsJs';
import {
  DEFAULT_MAP_FALLBACK,
  isGoogleMapsJavaScriptBlockingMessage,
  isInServiceArea,
  isReliableGpsLatLng,
  trustedMapCenter,
} from '../lib/googleMapsConfig';
import './LiveUserGoogleMap.css';

/** Google default pin: prefer live GPS in service area, else last throttled center, else map fallback. */
function resolveMarkerPosition(mapCenter, fallbackCenter, hasFix) {
  if (hasFix && mapCenter && isInServiceArea(mapCenter.lat, mapCenter.lng)) {
    return { lat: mapCenter.lat, lng: mapCenter.lng };
  }
  if (mapCenter && isInServiceArea(mapCenter.lat, mapCenter.lng)) {
    return { lat: mapCenter.lat, lng: mapCenter.lng };
  }
  if (fallbackCenter && isReliableGpsLatLng(fallbackCenter.lat, fallbackCenter.lng)) {
    return { lat: fallbackCenter.lat, lng: fallbackCenter.lng };
  }
  return null;
}

const EMPTY_NEARBY_DRIVERS = Object.freeze([]);

function driverMarkerIcon(G) {
  const path = G?.maps?.SymbolPath?.CIRCLE;
  if (path == null) return undefined;
  return {
    path,
    scale: 9,
    fillColor: '#07408f',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

/** Teardrop pin matching Delivery UI dots (green pickup / orange drop-off). */
function routePinIcon(G, color) {
  return {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 1.5,
    scale: 1.55,
    anchor: new G.maps.Point(12, 22),
  };
}

function syncNearbyDriverMarkers(map, markersRef, nearbyDrivers) {
  const G = typeof window !== 'undefined' ? window.google : null;
  if (!G?.maps || !map) return;

  try {
    markersRef.current.forEach((m) => {
      try {
        m.setMap(null);
      } catch {
        // ignore
      }
    });
    markersRef.current = [];

    const icon = driverMarkerIcon(G);
    for (const d of nearbyDrivers || []) {
      const lat = Number(d.lat);
      const lng = Number(d.lng);
      if (!isReliableGpsLatLng(lat, lng)) continue;
      const title = [d.name, d.vehicleType, d.distanceKm != null ? `${d.distanceKm} km away` : '']
        .filter(Boolean)
        .join(' · ');
      const opts = {
        position: { lat, lng },
        map,
        title,
        zIndex: 500,
        optimized: true,
      };
      if (icon) opts.icon = icon;
      markersRef.current.push(new G.maps.Marker(opts));
    }
  } catch (err) {
    console.warn('[LiveUserGoogleMap] nearby driver markers failed', err);
  }
}

function applyUserLocationGraphics(map, markerRef, mapCenter, fallbackCenter, hasFix) {
  const G = typeof window !== 'undefined' ? window.google : null;
  if (!G?.maps) return;

  try {
    const pos = resolveMarkerPosition(mapCenter, fallbackCenter, hasFix);
    if (!pos) {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      markerRef.current = new G.maps.Marker({
        position: pos,
        map,
        optimized: true,
        zIndex: 999,
      });
    } else {
      markerRef.current.setPosition(pos);
      markerRef.current.setMap(map);
    }
  } catch (err) {
    console.warn('[LiveUserGoogleMap] user marker update failed', err);
  }
}

function clearMarker(markerRef) {
  try {
    markerRef.current?.setMap(null);
  } catch {
    // ignore
  }
  markerRef.current = null;
}

function coordsKey(c) {
  if (!c || !isReliableGpsLatLng(c.lat, c.lng)) return '';
  return `${Number(c.lat).toFixed(5)},${Number(c.lng).toFixed(5)}`;
}

/**
 * Interactive roadmap + optional draggable pickup/drop-off pins.
 */
export default function LiveUserGoogleMap({
  mapCenter,
  fallbackCenter = DEFAULT_MAP_FALLBACK,
  hasFix,
  accurate: _accurate = true,
  accuracyM: _accuracyM = null,
  onLoadError,
  className = '',
  zoomWithFix = 15,
  zoomFallback = 14,
  /** When false, no GPS dot / default marker (e.g. route pins already shown). */
  showUserLocationMarker = true,
  /** @type {Array<{ lat: number, lng: number, name?: string, vehicleType?: string, distanceKm?: number }>} */
  nearbyDrivers = EMPTY_NEARBY_DRIVERS,
  /** @type {{ lat: number, lng: number } | null | undefined} */
  pickupPin = null,
  /** @type {{ lat: number, lng: number } | null | undefined} */
  dropoffPin = null,
  /** @param {number} lat @param {number} lng */
  onPickupDragEnd,
  /** @param {number} lat @param {number} lng */
  onDropoffDragEnd,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const pickupMarkerRef = useRef(null);
  const dropoffMarkerRef = useRef(null);
  const routeLineRef = useRef(null);
  const driverMarkersRef = useRef([]);
  const draggingRef = useRef({ pickup: false, dropoff: false });
  const fittedKeyRef = useRef('');
  const userMovedRef = useRef(false);
  const lastCameraKeyRef = useRef('');
  const [mapReady, setMapReady] = useState(false);
  const blockedReportedRef = useRef(false);
  const mapCenterRef = useRef(mapCenter);
  const fallbackCenterRef = useRef(fallbackCenter);
  const hasFixRef = useRef(hasFix);
  const zoomWithFixRef = useRef(zoomWithFix);
  const zoomFallbackRef = useRef(zoomFallback);
  mapCenterRef.current = mapCenter;
  fallbackCenterRef.current = fallbackCenter;
  hasFixRef.current = hasFix;
  zoomWithFixRef.current = zoomWithFix;
  zoomFallbackRef.current = zoomFallback;

  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const onPickupDragEndRef = useRef(onPickupDragEnd);
  onPickupDragEndRef.current = onPickupDragEnd;
  const onDropoffDragEndRef = useRef(onDropoffDragEnd);
  onDropoffDragEndRef.current = onDropoffDragEnd;

  const signalMapsBlocked = useCallback(() => {
    if (blockedReportedRef.current) return;
    blockedReportedRef.current = true;
    onLoadErrorRef.current?.();
  }, []);

  useEffect(() => {
    const fromRejection = (ev) => {
      const r = ev?.reason;
      const text = (typeof r === 'string' ? r : r?.stack) || r?.message || '';
      if (isGoogleMapsJavaScriptBlockingMessage(text)) signalMapsBlocked();
    };
    const fromError = (ev) => {
      const text = ev?.message || ev?.error?.stack || '';
      if (!text) return;
      const fromMapsScript =
        /maps\.googleapis\.com|gstatic\.com\/maps|Google Maps JavaScript API error/i.test(
          `${text} ${ev?.filename || ''}`,
        );
      if (fromMapsScript && isGoogleMapsJavaScriptBlockingMessage(text)) signalMapsBlocked();
    };
    const onGmAuth = () => signalMapsBlocked();
    window.addEventListener('unhandledrejection', fromRejection);
    window.addEventListener('error', fromError);
    window.addEventListener(GM_AUTH_EVENT, onGmAuth);
    return () => {
      window.removeEventListener('unhandledrejection', fromRejection);
      window.removeEventListener('error', fromError);
      window.removeEventListener(GM_AUTH_EVENT, onGmAuth);
    };
  }, [signalMapsBlocked]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    let cancelled = false;
    let unbindResize = () => {};

    loadGoogleMapsJs()
      .then((google) => {
        if (cancelled || !el.isConnected) return;
        clearGoogleMapElement(el);
        const center = trustedMapCenter(mapCenterRef.current, fallbackCenterRef.current);
        const map = new google.maps.Map(el, {
          center,
          zoom:
            hasFixRef.current && mapCenterRef.current
              ? zoomWithFixRef.current
              : zoomFallbackRef.current,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        if (cancelled) {
          clearGoogleMapElement(el);
          return;
        }
        map.addListener('dragstart', () => {
          userMovedRef.current = true;
        });
        mapRef.current = map;
        unbindResize = bindGoogleMapResize(map, el);
        setMapReady(true);
      })
      .catch((err) => {
        console.error('[LiveUserGoogleMap] Maps JavaScript API failed to load', err);
        if (!cancelled) signalMapsBlocked();
      });

    return () => {
      cancelled = true;
      unbindResize();
      clearMarker(markerRef);
      clearMarker(pickupMarkerRef);
      clearMarker(dropoffMarkerRef);
      try {
        routeLineRef.current?.setMap(null);
      } catch {
        // ignore
      }
      routeLineRef.current = null;
      driverMarkersRef.current.forEach((m) => {
        try {
          m.setMap(null);
        } catch {
          // ignore
        }
      });
      driverMarkersRef.current = [];
      mapRef.current = null;
      clearGoogleMapElement(el);
    };
  }, [signalMapsBlocked]);

  const syncRoutePin = useCallback((kind, pin, markerRefLocal, color, title) => {
    const map = mapRef.current;
    const G = typeof window !== 'undefined' ? window.google : null;
    if (!map || !G?.maps) return;

    const lat = Number(pin?.lat);
    const lng = Number(pin?.lng);
    if (!isReliableGpsLatLng(lat, lng)) {
      clearMarker(markerRefLocal);
      return;
    }

    const pos = { lat, lng };
    const dragging = draggingRef.current[kind];
    if (!markerRefLocal.current) {
      const marker = new G.maps.Marker({
        position: pos,
        map,
        title,
        draggable: true,
        icon: routePinIcon(G, color),
        zIndex: kind === 'pickup' ? 900 : 910,
        optimized: false,
      });
      marker.addListener('dragstart', () => {
        draggingRef.current[kind] = true;
      });
      marker.addListener('dragend', () => {
        draggingRef.current[kind] = false;
        const p = marker.getPosition();
        if (!p) return;
        const nextLat = p.lat();
        const nextLng = p.lng();
        if (!isReliableGpsLatLng(nextLat, nextLng)) return;
        if (kind === 'pickup') onPickupDragEndRef.current?.(nextLat, nextLng);
        else onDropoffDragEndRef.current?.(nextLat, nextLng);
      });
      markerRefLocal.current = marker;
    } else if (!dragging) {
      markerRefLocal.current.setPosition(pos);
      markerRefLocal.current.setMap(map);
      markerRefLocal.current.setDraggable(true);
    }
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return;
    const map = mapRef.current;
    const G = window.google;
    const hasPickup = Boolean(pickupPin && isReliableGpsLatLng(pickupPin.lat, pickupPin.lng));
    const hasDropoff = Boolean(dropoffPin && isReliableGpsLatLng(dropoffPin.lat, dropoffPin.lng));
    const showRoutePins = hasPickup || hasDropoff;

    try {
      syncRoutePin('pickup', pickupPin, pickupMarkerRef, '#16a34a', 'Pickup — drag to adjust');
      syncRoutePin('dropoff', dropoffPin, dropoffMarkerRef, '#EC6C23', 'Drop-off — drag to adjust');

      if (hasPickup && hasDropoff) {
        const path = [
          { lat: Number(pickupPin.lat), lng: Number(pickupPin.lng) },
          { lat: Number(dropoffPin.lat), lng: Number(dropoffPin.lng) },
        ];
        if (!routeLineRef.current) {
          routeLineRef.current = new G.maps.Polyline({
            map,
            path,
            geodesic: true,
            strokeColor: '#07408f',
            strokeOpacity: 0.75,
            strokeWeight: 4,
            zIndex: 100,
          });
        } else {
          routeLineRef.current.setPath(path);
          routeLineRef.current.setMap(map);
        }
      } else if (routeLineRef.current) {
        routeLineRef.current.setMap(null);
      }

      if (showRoutePins) {
        clearMarker(markerRef);
        syncNearbyDriverMarkers(map, driverMarkersRef, []);

        const fitKey = `${coordsKey(pickupPin)}|${coordsKey(dropoffPin)}`;
        if (fitKey !== fittedKeyRef.current && !draggingRef.current.pickup && !draggingRef.current.dropoff) {
          fittedKeyRef.current = fitKey;
          userMovedRef.current = false;
          lastCameraKeyRef.current = '';
          if (hasPickup && hasDropoff) {
            const bounds = new G.maps.LatLngBounds();
            bounds.extend({ lat: Number(pickupPin.lat), lng: Number(pickupPin.lng) });
            bounds.extend({ lat: Number(dropoffPin.lat), lng: Number(dropoffPin.lng) });
            map.fitBounds(bounds, 48);
          } else if (hasPickup) {
            map.setCenter({ lat: Number(pickupPin.lat), lng: Number(pickupPin.lng) });
            map.setZoom(Math.max(13, zoomWithFix));
          } else if (hasDropoff) {
            map.setCenter({ lat: Number(dropoffPin.lat), lng: Number(dropoffPin.lng) });
            map.setZoom(Math.max(13, zoomWithFix));
          }
        }
        return;
      }

      fittedKeyRef.current = '';
      clearMarker(pickupMarkerRef);
      clearMarker(dropoffMarkerRef);
      if (routeLineRef.current) {
        routeLineRef.current.setMap(null);
      }

      const center =
        hasFix && mapCenter && isInServiceArea(mapCenter.lat, mapCenter.lng) ? mapCenter : fallbackCenter;
      if (!userMovedRef.current && center && isReliableGpsLatLng(center.lat, center.lng)) {
        const nextZoom = hasFix && mapCenter ? zoomWithFix : zoomFallback;
        const camKey = `${coordsKey(center)}|${nextZoom}`;
        if (camKey !== lastCameraKeyRef.current) {
          const first = !lastCameraKeyRef.current;
          lastCameraKeyRef.current = camKey;
          if (first) {
            map.setCenter(center);
            map.setZoom(nextZoom);
          } else {
            map.panTo(center);
          }
        }
      }
      if (showUserLocationMarker) {
        applyUserLocationGraphics(map, markerRef, mapCenter, fallbackCenter, hasFix);
      } else {
        clearMarker(markerRef);
      }
      syncNearbyDriverMarkers(map, driverMarkersRef, nearbyDrivers);
    } catch (err) {
      console.warn('[LiveUserGoogleMap] map update failed', err);
    }
  }, [
    mapReady,
    mapCenter,
    fallbackCenter,
    hasFix,
    zoomWithFix,
    zoomFallback,
    showUserLocationMarker,
    nearbyDrivers,
    pickupPin,
    dropoffPin,
    syncRoutePin,
  ]);

  const rootClass = ['ing-live-map__js', className].filter(Boolean).join(' ');
  return <div ref={elRef} className={rootClass} role="presentation" />;
}
