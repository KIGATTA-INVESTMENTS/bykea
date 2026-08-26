import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminHeaderRefresh, useSetAdminHeaderActions } from '../components/admin/adminHeaderActions';
import { shortBookingRef } from '../lib/driverIncomingBookings';
import { loadGoogleMapsJs, bindGoogleMapResize, clearGoogleMapElement } from '../lib/loadGoogleMapsJs';
import { DEFAULT_MAP_FALLBACK, isReliableGpsLatLng } from '../lib/googleMapsConfig';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './adminPortal.css';

const ONE_HOUR_MS = 60 * 60 * 1000;
const AUTO_REFRESH_MS = 25_000;
/** A driver counts as "online now" when their live location updated within this window. */
const LIVE_FRESH_MS = 5 * 60 * 1000;

const BOOKING_SOURCES = [
  {
    table: 'customer_delivery_orders',
    kind: 'parcel',
    kindLabel: 'Parcel',
    timeCol: 'created_at',
    toCol: 'dropoff_location',
    fromCol: 'pickup_location',
    amountCol: 'total_amount',
    completedVerb: 'Delivered',
    refOf: (r) => shortBookingRef(r.id),
  },
  {
    table: 'taxi_bookings',
    kind: 'taxi',
    kindLabel: 'Taxi',
    timeCol: 'created_at',
    toCol: 'destination_location',
    fromCol: 'pickup_location',
    amountCol: 'quoted_price',
    completedVerb: 'Completed',
    refOf: (r) => shortBookingRef(r.id),
  },
  {
    table: 'tuk_tuk_bookings',
    kind: 'tuktuk',
    kindLabel: 'Tuk-Tuk',
    timeCol: 'created_at',
    toCol: 'destination_location',
    fromCol: 'pickup_location',
    amountCol: 'quoted_price',
    completedVerb: 'Completed',
    refOf: (r) => shortBookingRef(r.id),
  },
  {
    table: 'shop_customer_orders',
    kind: 'shop',
    kindLabel: 'Shop order',
    timeCol: 'placed_at',
    toCol: 'customer_address',
    fromCol: null,
    amountCol: 'subtotal',
    completedVerb: 'Delivered',
    refOf: (r) => String(r.order_number || shortBookingRef(r.id)),
  },
];

function initials(name) {
  const n = String(name || '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(iso) {
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)} day(s) ago`;
}

function fmtClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function navLegLabel(leg) {
  const l = String(leg || '').toLowerCase();
  if (l === 'to_pickup') return 'Heading to pickup';
  if (l === 'to_dropoff') return 'Heading to drop-off';
  return '';
}

/** Build per-driver current location + last-hour activity from raw booking rows. */
function buildDriverState(drivers, rowsBySource) {
  const cutoff = Date.now() - ONE_HOUR_MS;
  const byId = new Map();
  for (const d of drivers) {
    byId.set(String(d.id), {
      driver: d,
      live: null,
      events: [],
    });
  }

  for (const src of BOOKING_SOURCES) {
    const rows = rowsBySource[src.table] || [];
    for (const r of rows) {
      const did = r.assigned_driver_id ? String(r.assigned_driver_id) : '';
      if (!did || !byId.has(did)) continue;
      const entry = byId.get(did);
      const ref = src.refOf(r);
      const to = String(r[src.toCol] || '').trim() || '—';
      const from = src.fromCol ? String(r[src.fromCol] || '').trim() : '';
      const amount = Number(r[src.amountCol]) || 0;

      const liveAt = r.driver_live_updated_at ? new Date(r.driver_live_updated_at).getTime() : 0;
      if (liveAt > 0 && isReliableGpsLatLng(r.driver_live_lat, r.driver_live_lng)) {
        if (!entry.live || liveAt > entry.live.atMs) {
          entry.live = {
            lat: Number(r.driver_live_lat),
            lng: Number(r.driver_live_lng),
            atMs: liveAt,
            at: r.driver_live_updated_at,
            leg: r.driver_nav_leg,
            ref,
            kindLabel: src.kindLabel,
            to,
          };
        }
      }

      const status = String(r.status || '').toLowerCase();
      const assignedAtMs = r.assigned_at ? new Date(r.assigned_at).getTime() : 0;
      if (assignedAtMs >= cutoff) {
        entry.events.push({
          atMs: assignedAtMs,
          at: r.assigned_at,
          label: `Accepted ${src.kindLabel} ${ref}`,
          sub: from ? `${from} → ${to}` : to,
          tone: 'accept',
        });
      }
      const completedAtMs = r.completed_at ? new Date(r.completed_at).getTime() : 0;
      if (completedAtMs >= cutoff) {
        const verb = status === 'cancelled' ? 'Cancelled' : src.completedVerb;
        entry.events.push({
          atMs: completedAtMs,
          at: r.completed_at,
          label: `${verb} ${src.kindLabel} ${ref}`,
          sub: amount ? `${to} · $${amount.toFixed(2)}` : to,
          tone: status === 'cancelled' ? 'cancel' : 'done',
        });
      }
    }
  }

  const list = [...byId.values()].map((entry) => {
    entry.events.sort((a, b) => b.atMs - a.atMs);
    return entry;
  });

  list.sort((a, b) => {
    const al = a.live?.atMs || 0;
    const bl = b.live?.atMs || 0;
    if (bl !== al) return bl - al;
    return String(a.driver.full_name || '').localeCompare(String(b.driver.full_name || ''));
  });
  return list;
}

/** Multi-driver Google map with one labelled marker per driver that has a live fix. */
function DriversMap({ points }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    let cancelled = false;
    let unbindResize = () => {};
    loadGoogleMapsJs()
      .then((google) => {
        if (cancelled || !el.isConnected) return;
        clearGoogleMapElement(el);
        const map = new google.maps.Map(el, {
          center: DEFAULT_MAP_FALLBACK,
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: false,
        });
        if (cancelled) {
          clearGoogleMapElement(el);
          return;
        }
        mapRef.current = map;
        unbindResize = bindGoogleMapResize(map, el);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      unbindResize();
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
      clearGoogleMapElement(el);
    };
  }, []);

  useEffect(() => {
    const G = typeof window !== 'undefined' ? window.google : null;
    if (!ready || !mapRef.current || !G?.maps) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const valid = points.filter((p) => isReliableGpsLatLng(p.lat, p.lng));
    if (!valid.length) return;

    const bounds = new G.maps.LatLngBounds();
    for (const p of valid) {
      const pos = { lat: p.lat, lng: p.lng };
      const marker = new G.maps.Marker({
        position: pos,
        map: mapRef.current,
        title: `${p.name} — ${timeAgo(p.at)}`,
        label: { text: p.label, color: '#fff', fontSize: '11px', fontWeight: '700' },
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
    }
    if (valid.length === 1) {
      mapRef.current.setCenter({ lat: valid[0].lat, lng: valid[0].lng });
      mapRef.current.setZoom(15);
    } else {
      mapRef.current.fitBounds(bounds, 64);
    }
  }, [ready, points]);

  if (failed) {
    return (
      <div className="admCard" style={{ color: '#b42318', fontWeight: 600 }}>
        Google Maps could not load. Check REACT_APP_GOOGLE_MAPS_API_KEY and the key’s HTTP referrer / Maps JavaScript API settings.
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      style={{ width: '100%', height: '420px', borderRadius: '14px', overflow: 'hidden', background: '#e9eef5' }}
      role="presentation"
    />
  );
}

export default function AdminDriverLocationsPage() {
  const [drivers, setDrivers] = useState([]);
  const [rowsBySource, setRowsBySource] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [lastSync, setLastSync] = useState(null);

  const load = useCallback(async () => {
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setDrivers([]);
      setRowsBySource({});
      setError('Database is not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: drvData, error: drvErr } = await supabase
      .from('driver_registrations')
      .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_plate')
      .eq('status', 'approved')
      .order('full_name', { ascending: true });
    if (drvErr) {
      setError(drvErr.message || 'Could not load drivers.');
      setDrivers([]);
      setRowsBySource({});
      setLoading(false);
      return;
    }

    const results = await Promise.all(
      BOOKING_SOURCES.map((src) =>
        supabase
          .from(src.table)
          .select('*')
          .not('assigned_driver_id', 'is', null)
          .order(src.timeCol, { ascending: false })
          .limit(120),
      ),
    );

    const next = {};
    let firstErr = '';
    results.forEach((res, i) => {
      const src = BOOKING_SOURCES[i];
      if (res.error) {
        if (!firstErr) firstErr = res.error.message || '';
        next[src.table] = [];
      } else {
        next[src.table] = res.data || [];
      }
    });

    setDrivers(drvData || []);
    setRowsBySource(next);
    setLastSync(new Date());
    setLoading(false);
    if (firstErr) {
      setError(
        /assigned_driver_id|driver_live_lat|driver_live_updated_at|column/i.test(firstErr)
          ? `${firstErr} — Run supabase/driver_booking_assignment.sql and supabase/driver_live_tracking.sql.`
          : firstErr,
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => load(), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useSetAdminHeaderActions(<AdminHeaderRefresh onClick={() => load()} disabled={loading} />, [loading, load]);

  const driverState = useMemo(() => buildDriverState(drivers, rowsBySource), [drivers, rowsBySource]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return driverState;
    return driverState.filter((e) => {
      const hay = [e.driver.full_name, e.driver.phone, e.driver.vehicle_plate, e.driver.vehicle_type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [driverState, search]);

  const mapPoints = useMemo(
    () =>
      driverState
        .filter((e) => e.live && isReliableGpsLatLng(e.live.lat, e.live.lng))
        .map((e) => ({
          lat: e.live.lat,
          lng: e.live.lng,
          at: e.live.at,
          name: e.driver.full_name || 'Driver',
          label: initials(e.driver.full_name),
        })),
    [driverState],
  );

  const onlineCount = useMemo(
    () => driverState.filter((e) => e.live && Date.now() - e.live.atMs <= LIVE_FRESH_MS).length,
    [driverState],
  );
  const activeCount = useMemo(() => driverState.filter((e) => e.events.length > 0).length, [driverState]);

  return (
    <div className="adm">
      <p className="admDim" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', maxWidth: '46rem' }}>
        Live map of every approved driver’s last known location (updated while they navigate an active job) and a log of
        what each driver has done in the last hour. Auto-refreshes every {Math.round(AUTO_REFRESH_MS / 1000)}s.
      </p>

      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard">
          <p className="k">Approved drivers</p>
          <p className="v" style={{ color: '#0A58A6' }}>{drivers.length}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Online now</p>
          <p className="v" style={{ color: '#166534' }}>{onlineCount}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Active in last hour</p>
          <p className="v" style={{ color: '#b45309' }}>{activeCount}</p>
        </article>
        <article className="admCard admSmallCard">
          <p className="k">Last sync</p>
          <p className="v" style={{ fontSize: '1rem' }}>{lastSync ? fmtClock(lastSync.toISOString()) : '—'}</p>
        </article>
      </section>

      {error ? (
        <p className="admCard" style={{ color: '#b42318', fontWeight: 600 }} role="alert">
          {error}
        </p>
      ) : null}

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <DriversMap points={mapPoints} />
        {mapPoints.length === 0 ? (
          <p className="admDim" style={{ margin: '0.6rem 0 0', fontSize: '0.84rem' }}>
            No drivers are sharing a live location right now. Markers appear while a driver is navigating an active job.
          </p>
        ) : null}
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSearch">
          <input
            placeholder="Search driver name, phone, plate…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </section>

      <section style={{ display: 'grid', gap: '0.8rem' }}>
        {loading && driverState.length === 0 ? (
          <p className="admCard admDim">Loading drivers…</p>
        ) : filtered.length === 0 ? (
          <p className="admCard admDim">No drivers match your search.</p>
        ) : (
          filtered.map((e) => {
            const d = e.driver;
            const live = e.live;
            const isOnline = live && Date.now() - live.atMs <= LIVE_FRESH_MS;
            return (
              <article key={d.id} className="admCard" style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
                  <span className="admAvatar" style={{ width: 38, height: 38, fontSize: '0.8rem' }}>
                    {initials(d.full_name)}
                  </span>
                  <div style={{ flex: '1 1 12rem', minWidth: '10rem' }}>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {d.full_name || 'Driver'}
                      <span
                        className="admBadgeStatus"
                        style={{
                          background: isOnline ? '#dcfce7' : '#f1f5f9',
                          color: isOnline ? '#166534' : '#64748b',
                        }}
                      >
                        {isOnline ? '● Online' : 'Offline'}
                      </span>
                    </div>
                    <div className="admDim" style={{ fontSize: '0.82rem' }}>
                      {d.vehicle_type || '—'} {d.vehicle_plate ? `· ${d.vehicle_plate}` : ''}
                      {d.phone ? ` · ${d.phone_country_code || ''} ${d.phone}` : ''}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)',
                    gap: '0.8rem',
                  }}
                  className="admDriverLocGrid"
                >
                  <div>
                    <p style={{ margin: '0 0 0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>
                      Current location
                    </p>
                    {live ? (
                      <>
                        <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600 }}>
                          {live.lat.toFixed(5)}, {live.lng.toFixed(5)}
                        </p>
                        <p className="admDim" style={{ margin: '0.15rem 0 0', fontSize: '0.8rem' }}>
                          Updated {timeAgo(live.at)}
                          {navLegLabel(live.leg) ? ` · ${navLegLabel(live.leg)}` : ''}
                        </p>
                        <p className="admDim" style={{ margin: '0.15rem 0 0', fontSize: '0.8rem' }}>
                          On {live.kindLabel} {live.ref} → {live.to}
                        </p>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${live.lat},${live.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: '0.8rem', fontWeight: 600 }}
                        >
                          Open in Google Maps
                        </a>
                      </>
                    ) : (
                      <p className="admDim" style={{ margin: 0, fontSize: '0.84rem' }}>
                        No live location. Not on an active job.
                      </p>
                    )}
                  </div>

                  <div>
                    <p style={{ margin: '0 0 0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>
                      Last 1 hour activity
                    </p>
                    {e.events.length === 0 ? (
                      <p className="admDim" style={{ margin: 0, fontSize: '0.84rem' }}>
                        No activity in the last hour.
                      </p>
                    ) : (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
                        {e.events.map((ev, idx) => (
                          <li
                            key={`${ev.atMs}-${idx}`}
                            style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start' }}
                          >
                            <span
                              aria-hidden
                              style={{
                                marginTop: 5,
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                flex: '0 0 auto',
                                background:
                                  ev.tone === 'done' ? '#16a34a' : ev.tone === 'cancel' ? '#dc2626' : '#0A58A6',
                              }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: '0.86rem', fontWeight: 600 }}>
                                {ev.label}
                                <span className="admDim" style={{ fontWeight: 400 }}> · {fmtClock(ev.at)}</span>
                              </p>
                              {ev.sub ? (
                                <p className="admDim" style={{ margin: 0, fontSize: '0.8rem' }}>{ev.sub}</p>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
