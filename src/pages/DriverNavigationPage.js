import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import { DEFAULT_DRIVER_ORDER } from '../data/driverOrderDefaults';
import { useLiveLocation } from '../hooks/useLiveLocation';
import {
  driverOrderNeedsCashCollectionScreen,
  fetchBookingCustomerContact,
  markDriverBookingCompleted,
} from '../lib/driverIncomingBookings';
import {
  googleMapsDirectionsDestOnlyUrl,
  isReliableGpsLatLng,
  publicDirectionsCoordsMapUrl,
  publicDirectionsMapUrl,
  publicPlaceMapUrl,
} from '../lib/googleMapsConfig';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './driverDelivery.css';

export default function DriverNavigationPage() {
  const navigate = useNavigate();
  const live = useLiveLocation({ mapThrottleMs: 1000 });
  const { state } = useLocation();
  const [ending, setEnding] = useState(false);
  const [liveSyncDisabled, setLiveSyncDisabled] = useState(false);
  const o = useMemo(
    () => (state?.order ? { ...DEFAULT_DRIVER_ORDER, ...state.order } : { ...DEFAULT_DRIVER_ORDER }),
    [state],
  );
  const isParcelDelivery = useMemo(
    () =>
      String(o.bookingTable || '') === 'customer_delivery_orders' ||
      String(o.bookingTable || '') === 'shop_customer_orders' ||
      String(o.bookingKind || '').toLowerCase() === 'parcel',
    [o.bookingTable, o.bookingKind],
  );
  const pickup = String(state?.pickup || o.from || '').trim();
  const dropoff = String(state?.dropoff || o.to || '').trim();
  const [customerName, setCustomerName] = useState(String(o.customerName || '').trim() || 'Customer');
  const [customerPhone, setCustomerPhone] = useState(String(o.customerPhone || '').trim());
  const phase = state?.phase === 'dropoff' ? 'dropoff' : 'pickup';
  /** Main leg: pickup → drop-off (set from active delivery). Legacy: `phase === 'dropoff'`. */
  const toDropoff = state?.navLeg === 'toDropoff' || phase === 'dropoff';
  const dest = String(state?.dest || (toDropoff ? dropoff : pickup) || '').trim();
  const [destGeo, setDestGeo] = useState(null);
  const routeLat = useMemo(
    () => (isReliableGpsLatLng(live.lat, live.lng) ? Number(Number(live.lat).toFixed(5)) : null),
    [live.lat, live.lng],
  );
  const routeLng = useMemo(
    () => (isReliableGpsLatLng(live.lat, live.lng) ? Number(Number(live.lng).toFixed(5)) : null),
    [live.lat, live.lng],
  );
  const [routedOrigin, setRoutedOrigin] = useState(null);

  useEffect(() => {
    if (routeLat == null || routeLng == null) return;
    // Keep map stable: lock origin at first reliable fix (or when route phase changes).
    if (!routedOrigin) setRoutedOrigin({ lat: routeLat, lng: routeLng });
  }, [routeLat, routeLng, routedOrigin]);

  useEffect(() => {
    // Re-lock once when switching pickup/drop-off so each phase gets a stable map.
    setRoutedOrigin(null);
  }, [toDropoff, pickup, dropoff]);

  useEffect(() => {
    setCustomerName(String(o.customerName || '').trim() || 'Customer');
    setCustomerPhone(String(o.customerPhone || '').trim());
  }, [o.customerName, o.customerPhone]);

  useEffect(() => {
    let cancelled = false;
    const table = o.bookingTable;
    const id = o.supabaseOrderId;
    if (!isSupabaseConfigured || !supabase || !table || !id) return undefined;
    (async () => {
      const { full_name, phone } = await fetchBookingCustomerContact(supabase, table, id);
      if (cancelled) return;
      if (full_name) setCustomerName(full_name);
      if (phone) setCustomerPhone(phone);
    })();
    return () => {
      cancelled = true;
    };
  }, [o.bookingTable, o.supabaseOrderId]);

  useEffect(() => {
    let cancelled = false;
    if (!dest) {
      setDestGeo(null);
      return undefined;
    }
    (async () => {
      try {
        const g = await forwardGeocodeAddress(dest);
        if (!cancelled && g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
          setDestGeo({ lat: g.lat, lng: g.lng });
          return;
        }
        if (!cancelled) setDestGeo(null);
      } catch {
        if (!cancelled) setDestGeo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dest]);

  const navMapSrc = useMemo(() => {
    const pu = pickup || 'London, UK';
    const dr = (dropoff || pu).trim();
    const target = toDropoff ? dr : pu;
    if (
      destGeo &&
      routedOrigin &&
      Number.isFinite(destGeo.lat) &&
      Number.isFinite(destGeo.lng)
    ) {
      const coordsRoute = publicDirectionsCoordsMapUrl(routedOrigin.lat, routedOrigin.lng, destGeo.lat, destGeo.lng);
      if (coordsRoute) return coordsRoute;
    }
    if (routedOrigin && target) {
      const liveToTarget = publicDirectionsMapUrl(`${routedOrigin.lat},${routedOrigin.lng}`, target);
      if (liveToTarget) return liveToTarget;
    }
    if (toDropoff && pu && dr) return publicDirectionsMapUrl(pu, dr);
    return publicPlaceMapUrl(target);
  }, [toDropoff, pickup, dropoff, destGeo, routedOrigin]);

  const onEndJourney = useCallback(async () => {
    setEnding(true);
    const table = o.bookingTable;
    const id = o.supabaseOrderId;
    if (isSupabaseConfigured && supabase && table && id) {
      await markDriverBookingCompleted(supabase, table, id);
    }
    setEnding(false);
    if (driverOrderNeedsCashCollectionScreen(o)) {
      navigate('/driver/collect-payment', { replace: true, state: { order: o } });
    } else {
      navigate('/driver/rate-customer', { replace: true, state: { order: o } });
    }
  }, [navigate, o]);

  const onCustomerPickedUp = useCallback(async () => {
    const table = o.bookingTable;
    const id = o.supabaseOrderId;
    if (isSupabaseConfigured && supabase && table === 'shop_customer_orders' && id) {
      await supabase.from('shop_customer_orders').update({ status: 'picked up' }).eq('id', id);
    }
    navigate('/driver/navigation', {
      replace: true,
      state: {
        order: o,
        pickup,
        dropoff,
        dest: dropoff,
        navLeg: 'toDropoff',
        phase: 'dropoff',
      },
    });
  }, [navigate, o, pickup, dropoff]);

  useEffect(() => {
    const table = o.bookingTable;
    const id = o.supabaseOrderId;
    if (!isSupabaseConfigured || !supabase || table !== 'customer_delivery_orders' || !id || liveSyncDisabled) {
      return undefined;
    }
    if (!isReliableGpsLatLng(live.lat, live.lng)) return undefined;
    let cancelled = false;
    const syncOnce = async () => {
      const payload = {
        driver_live_lat: Number(live.lat),
        driver_live_lng: Number(live.lng),
        driver_live_updated_at: new Date().toISOString(),
        driver_nav_leg: toDropoff ? 'to_dropoff' : 'to_pickup',
      };
      const { error } = await supabase.from(table).update(payload).eq('id', id);
      if (cancelled || !error) return;
      if (/driver_live_lat|driver_live_lng|driver_nav_leg|driver_live_updated_at|column/i.test(error.message || '')) {
        setLiveSyncDisabled(true);
      }
    };
    syncOnce();
    const timer = window.setInterval(syncOnce, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [o.bookingTable, o.supabaseOrderId, live.lat, live.lng, toDropoff, liveSyncDisabled]);

  const openInGoogleMaps = useCallback(() => {
    const target = toDropoff ? dropoff : pickup;
    const url = googleMapsDirectionsDestOnlyUrl(target);
    if (url) window.open(url, '_blank', 'noopener');
  }, [toDropoff, dropoff, pickup]);

  return (
    <div className="nav-page" role="application" aria-label="Navigation">
      <div className={`nav-mapV${navMapSrc ? ' nav-mapV--gmap' : ''}`} aria-hidden>
        <GoogleMapEmbed src={navMapSrc} title="Driving directions" />
        {!navMapSrc ? (
          <svg viewBox="0 0 320 480" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
            <rect width="320" height="480" fill="#3a4a5a" />
            <path
              d="M 40 400 Q 100 200 180 80 T 300 20"
              fill="none"
              stroke="#0A58A6"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
          </svg>
        ) : null}
        <div className="nav-trf" />
      </div>
      <div className="nav-ov2" role="region" aria-label="Route actions">
        <p className="nav-destB">{toDropoff ? 'Drop-off' : 'Pickup'}</p>
        <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.35 }}>{dest}</p>
        {!toDropoff && dropoff && dropoff !== pickup ? <p className="nav-txt">Next: {dropoff}</p> : null}
        <div className="nav-cusBox" aria-label="Customer details">
          <p className="nav-cusName">{customerName}</p>
          <p className="nav-cusPhone">{customerPhone || 'Phone not available yet'}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.65rem' }}>
          <button
            type="button"
            className="nav-mainBtn"
            style={{ background: '#1565c0' }}
            onClick={openInGoogleMaps}
          >
            Open in Google Maps
          </button>
          {!toDropoff ? (
            <button
              type="button"
              className="nav-mainBtn nav-mainBtn--pickup"
              onClick={onCustomerPickedUp}
              aria-label={isParcelDelivery ? 'Parcel picked up, continue to drop-off' : 'Customer picked up, continue to drop-off'}
            >
              {isParcelDelivery ? 'Parcel picked up' : 'Customer Picked Up'}
            </button>
          ) : null}
        </div>
        {toDropoff ? (
          <button
            type="button"
            className="nav-mainBtn nav-mainBtn--done"
            disabled={ending}
            onClick={onEndJourney}
          >
            {ending ? 'Ending…' : 'End journey'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
