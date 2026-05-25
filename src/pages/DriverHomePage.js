import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import LiveUserGoogleMap from '../components/LiveUserGoogleMap';
import { useLiveLocation } from '../hooks/useLiveLocation';
import {
  driverAcceptOffer,
  driverRejectOffer,
  fetchOpenOffersForDriver,
  fetchRecentForDriver,
  formatOfferTime,
  offerToActiveDeliveryOrder,
} from '../lib/driverIncomingBookings';
import { formatGBP } from '../lib/currency';
import { DRIVER_SECURITY_DEPOSIT_MIN_GBP, fetchDriverDepositBalance } from '../lib/driverDepositGate';
import { getDriverSession } from '../lib/driverSession';
import { getGoogleMapsApiKey, publicViewMapUrl } from '../lib/googleMapsConfig';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import CarIcon from '../components/icons/CarIcon';
import { LOGIN_HERO_ART } from '../lib/ingoLogo';
import './driverPortal.css';
import './driverHomePremium.css';

/** Same lat/lng fallback as customer `/home` map when GPS is unavailable. */
const DRIVER_MAP_FALLBACK = { lat: 51.5246, lng: -0.0772 };

/** Match customer home: embed-only when env set, no key, or Maps JS failed. */
function useDriverMapsEmbedOnly() {
  return useMemo(
    () => String(process.env.REACT_APP_HOME_USE_MAPS_EMBED_ONLY || '').trim().toLowerCase() === 'true',
    [],
  );
}

/** Time window from when this device first shows an offer — accept/reject or it disappears. */
const OFFER_WINDOW_MS = 60_000;
const SS_FIRST_SEEN = 'ingo_driver_offer_first_seen:';

function getOfferFirstSeenMs(offerId) {
  if (!offerId) return Date.now();
  try {
    const k = `${SS_FIRST_SEEN}${offerId}`;
    const raw = sessionStorage.getItem(k);
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
    const t = Date.now();
    sessionStorage.setItem(k, String(t));
    return t;
  } catch {
    return Date.now();
  }
}

function clearOfferFirstSeen(offerId) {
  if (!offerId) return;
  try {
    sessionStorage.removeItem(`${SS_FIRST_SEEN}${offerId}`);
  } catch {
    // ignore
  }
}

function offerSecondsLeft(offerId) {
  const elapsed = Date.now() - getOfferFirstSeenMs(offerId);
  return Math.max(0, Math.ceil((OFFER_WINDOW_MS - elapsed) / 1000));
}

function isOfferStillVisible(offerId) {
  return Date.now() - getOfferFirstSeenMs(offerId) < OFFER_WINDOW_MS;
}

function kindLabel(kind) {
  if (kind === 'parcel') return 'Delivery';
  if (kind === 'shop') return 'Shop delivery';
  if (kind === 'tuktuk') return 'Tuk-Tuk';
  return 'Taxi';
}

/** Readable place line: title-case words; keep leading numeric tokens as-is. */
function titleCasePlaceLine(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => {
      if (!w) return w;
      if (/^\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Visual tone for left stripe + badge (matches common DB status strings). */
function recentJobTone(st) {
  const s = String(st || '').toLowerCase();
  if (s.includes('cancel')) return 'cancel';
  if (s.includes('complete') || s.includes('delivered')) return 'done';
  if (s.includes('assign') || s.includes('active') || s.includes('en route') || s.includes('pickup')) return 'prog';
  if (s.includes('confirm') || s.includes('pending') || s.includes('request') || s.includes('placed')) return 'conf';
  return 'neu';
}

function OfferPinPickup() {
  return (
    <svg className="dh-offerCard__pinSvg" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M12 21s7-4.35 7-10a7 7 0 1 0-14 0c0 5.65 7 10 7 10Z"
        fill="rgba(241,134,49,0.15)"
        stroke="#e07828"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2.2" fill="#F18631" />
    </svg>
  );
}

function OfferPinDrop() {
  return (
    <svg className="dh-offerCard__pinSvg" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M12 21s7-4.35 7-10a7 7 0 1 0-14 0c0 5.65 7 10 7 10Z"
        fill="rgba(229,57,53,0.12)"
        stroke="#c62828"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2.2" fill="#e53935" />
    </svg>
  );
}

function IconPower() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v8M8.5 8.5a6 6 0 1 0 7 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconOnline() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M8 12.5l3 2.5 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconWarn() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4.5 3.5 19h17L12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v4M12 17v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconWarnSmall() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4.5 3.5 19h17L12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconRecentEmpty() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden style={{ margin: '0 auto 0.65rem', display: 'block', color: '#9ca3af' }}>
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function JobKindIcon({ kind }) {
  const common = { width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'aria-hidden': true };
  if (kind === 'parcel' || kind === 'shop') {
    return (
      <svg viewBox="0 0 24 24" {...common} strokeWidth="1.7" strokeLinejoin="round">
        <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
        <path d="m4 7 8 4 8-4M12 11v10" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'tuktuk') {
    return (
      <svg viewBox="0 0 24 24" {...common} strokeWidth="1.5">
        <rect x="3" y="8" width="12" height="6" rx="0.5" />
        <path d="M15 10h3l1 1h1.2a.8.8 0 0 1 .7.4V13" strokeLinecap="round" />
        <circle cx="6.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="11.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="19" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return <CarIcon size={20} />;
}

export default function DriverHomePage() {
  const navigate = useNavigate();
  const live = useLiveLocation({ mapThrottleMs: 4000 });
  const driverEmbedOnly = useDriverMapsEmbedOnly();
  const hasMapsKey = Boolean(getGoogleMapsApiKey());
  const [driverJsMapFailed, setDriverJsMapFailed] = useState(false);
  const useEmbedDriverMap = driverEmbedOnly || !hasMapsKey || driverJsMapFailed;

  const driverMapSrc = useMemo(() => {
    const c = live.mapCenter;
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
      return publicViewMapUrl(c.lat, c.lng, 14);
    }
    return publicViewMapUrl(DRIVER_MAP_FALLBACK.lat, DRIVER_MAP_FALLBACK.lng, 14);
  }, [live.mapCenter]);

  const driverJsMapCenter = useMemo(() => {
    if (live.hasFix && live.lat != null && live.lng != null) {
      return { lat: live.lat, lng: live.lng };
    }
    return live.mapCenter;
  }, [live.hasFix, live.lat, live.lng, live.mapCenter]);

  const [online, setOnline] = useState(true);
  const [offers, setOffers] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [depositBalance, setDepositBalance] = useState(null);
  const [depositMissing, setDepositMissing] = useState(false);
  const autoOfflineNoteRef = useRef(false);
  const onlineRef = useRef(online);

  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  /** Re-render every second for countdown / expiry */
  const [, setSecTick] = useState(0);

  const driverSession = getDriverSession();
  const driverId = driverSession?.id || null;
  const driverVehicleType = driverSession?.vehicle_type || '';

  useEffect(() => {
    if (!online) return undefined;
    const id = window.setInterval(() => setSecTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [online]);

  const visibleOffers = !online ? [] : offers.filter((o) => o.id && isOfferStillVisible(o.id));

  useEffect(() => {
    if (!driverId || !isSupabaseConfigured || !supabase) {
      setOffers([]);
      setRecent([]);
      if (!isSupabaseConfigured || !supabase) {
        setLoadErr('Supabase is not configured. Add keys to use live customer bookings.');
      } else {
        setLoadErr('');
      }
      return undefined;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        const dep = await fetchDriverDepositBalance(supabase, driverId);
        if (cancelled) return;
        let allowOffers = onlineRef.current;
        setDepositMissing(Boolean(dep.missingColumn));
        if (dep.missingColumn) {
          setDepositBalance(null);
        } else if (dep.error) {
          setDepositBalance(null);
        } else {
          const bal = dep.balance ?? 0;
          setDepositBalance(bal);
          if (allowOffers && bal < DRIVER_SECURITY_DEPOSIT_MIN_GBP) {
            setOnline(false);
            allowOffers = false;
            if (!autoOfflineNoteRef.current) {
              autoOfflineNoteRef.current = true;
              setActionMsg(
                `Your security deposit is below ${formatGBP(DRIVER_SECURITY_DEPOSIT_MIN_GBP)}. You have been taken offline. Top up in Wallet.`,
              );
            }
          } else if (bal >= DRIVER_SECURITY_DEPOSIT_MIN_GBP) {
            autoOfflineNoteRef.current = false;
          }
        }

        const rec = await fetchRecentForDriver(supabase, driverId);
        if (cancelled) return;
        setRecent(rec);
        if (allowOffers) {
          const next = await fetchOpenOffersForDriver(supabase, driverId, driverVehicleType);
          if (cancelled) return;
          setOffers(next);
        } else {
          setOffers([]);
        }
        setLoadErr('');
      } catch (e) {
        if (!cancelled) setLoadErr(e?.message || String(e));
      }
    };

    tick();
    const id = setInterval(tick, 4500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [driverId, driverVehicleType]);

  const recentTotal = useMemo(() => recent.reduce((s, r) => s + (Number(r.amt) || 0), 0), [recent]);

  const acceptBlocked = useMemo(
    () =>
      depositMissing ||
      depositBalance === null ||
      (typeof depositBalance === 'number' && depositBalance < DRIVER_SECURITY_DEPOSIT_MIN_GBP),
    [depositMissing, depositBalance],
  );

  const offerKey = (o) => `${o.table}:${o.id}`;

  const handleOnlineSwitch = useCallback(async () => {
    if (online) {
      setOnline(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase || !driverId) {
      setActionMsg('Connect Supabase to verify your security deposit before going online.');
      return;
    }
    const dep = await fetchDriverDepositBalance(supabase, driverId);
    if (dep.missingColumn) {
      setActionMsg(
        'Security deposit column missing. Run supabase/driver_registrations_driver_deposit_balance.sql in the SQL editor.',
      );
      return;
    }
    if (dep.error) {
      setActionMsg(dep.error);
      return;
    }
    if ((dep.balance ?? 0) < DRIVER_SECURITY_DEPOSIT_MIN_GBP) {
      setActionMsg(`Top up to at least ${formatGBP(DRIVER_SECURITY_DEPOSIT_MIN_GBP)} in Wallet before going online.`);
      return;
    }
    setActionMsg('');
    setOnline(true);
  }, [online, driverId]);

  const onAccept = useCallback(
    async (offer) => {
      if (!supabase || !driverId) return;
      const k = offerKey(offer);
      setBusyKey(k);
      setActionMsg('');
      const res = await driverAcceptOffer(supabase, offer, driverId, driverVehicleType);
      setBusyKey('');
      if (!res.ok) {
        setActionMsg(res.taken ? res.error : res.error || 'Could not accept.');
        return;
      }
      setOffers((prev) => prev.filter((x) => offerKey(x) !== k));
      clearOfferFirstSeen(offer.id);
      const rec = await fetchRecentForDriver(supabase, driverId);
      setRecent(rec);

      navigate('/driver/active-delivery', { state: { order: offerToActiveDeliveryOrder(offer) } });
    },
    [driverId, driverVehicleType, navigate],
  );

  const onReject = useCallback(
    async (offer) => {
      if (!supabase || !driverId) return;
      const k = offerKey(offer);
      setBusyKey(k);
      setActionMsg('');
      const res = await driverRejectOffer(supabase, offer, driverId);
      setBusyKey('');
      if (!res.ok) {
        setActionMsg(res.error || 'Could not save rejection.');
        return;
      }
      setOffers((prev) => prev.filter((x) => offerKey(x) !== k));
      clearOfferFirstSeen(offer.id);
    },
    [driverId],
  );

  return (
    <div className="dh dh--premium" role="main" aria-label="Driver home">
      <header className="dh__top">
        <h1 className="dh__brand">
          <img src={LOGIN_HERO_ART} alt="" className="dh__brandRider" decoding="async" />
          <span className="dh__brandText">Driver</span>
        </h1>
        <div className="dh__togR">
          <button type="button" className="dh__chatBtn" onClick={() => navigate('/driver/chat')}>
            Chat
          </button>
          <span className={online ? 'dh__togL dh__togL--g' : 'dh__togL dh__togL--gry'}>{online ? 'Online' : 'Offline'}</span>
          <button
            type="button"
            className={online ? 'dh__sw dh__sw--on' : 'dh__sw'}
            onClick={handleOnlineSwitch}
            role="switch"
            aria-checked={online}
            aria-label={online ? 'Go offline' : 'Go online'}
          >
            <span className="dh__k" aria-hidden />
          </button>
        </div>
      </header>

      <div
        className={`dh__mapWrap${!useEmbedDriverMap || driverMapSrc ? ' dh__mapWrap--gmap' : ''}`}
        aria-hidden="true"
      >
        {useEmbedDriverMap ? (
          <GoogleMapEmbed src={driverMapSrc} title="Map near you" loading="eager" />
        ) : (
          <LiveUserGoogleMap
            mapCenter={driverJsMapCenter}
            fallbackCenter={DRIVER_MAP_FALLBACK}
            hasFix={live.hasFix}
            accurate={live.hasFix}
            accuracyM={live.accuracy}
            onLoadError={() => setDriverJsMapFailed(true)}
            zoomWithFix={14}
            zoomFallback={13}
          />
        )}
      </div>

      <div className="dh__sc">
        <div className={`dh__status dh__card ${online ? 'dh__status--on' : 'dh__status--off'}`}>
          <span className="dh__statusIconWrap" aria-hidden>
            {online ? <IconOnline /> : <IconPower />}
          </span>
          <div className="dh__statusText">
            <h2 className="dh__statusTitle">{online ? 'You are Online' : 'You are Offline'}</h2>
            <p className="dh__statusSub">
              {online
                ? 'Each request shows for 60 seconds — accept, reject, or it disappears from your list.'
                : 'Toggle online to receive delivery, taxi, and Tuk-Tuk requests'}
            </p>
          </div>
        </div>

        <div className="dh__st" aria-label="Session stats">
          <div
            className="dh__stB dh__stB--offers"
            role="img"
            aria-label={`${online ? visibleOffers.length : 0} open offers`}
          >
            <p className="dh__stN">{online ? visibleOffers.length : 0}</p>
            <p className="dh__stT">Open Offers</p>
            <span className="dh__stLive">LIVE</span>
          </div>
          <div className="dh__stB dh__stB--earn" aria-label={`Recent earnings ${formatGBP(recentTotal)}`}>
            <p className="dh__stG">{formatGBP(recentTotal)}</p>
            <p className="dh__stT">Recent Jobs</p>
            <p className="dh__stSub">{recent.length} TOTAL</p>
          </div>
          <div className="dh__stB dh__stB--sync" role="status" aria-label="Offers refresh about every 4 seconds">
            <span className="dh__stIcoWrap" aria-hidden>
              <svg className="dh__stIco" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
                <path
                  d="M4.5 9.5a7.5 7.5 0 0 1 14.5-2.2M19.5 14.5a7.5 7.5 0 0 1-14.5 2.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M19 4v4.5h-4.5M5 20v-4.5h4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <p className="dh__stT">Refresh</p>
            <p className="dh__stSub">~4s</p>
          </div>
        </div>

        {depositMissing ? (
          <p className="dh__alert dh__alert--info" role="alert">
            Run <code>driver_registrations_driver_deposit_balance.sql</code> so the app can enforce the �$10 security
            deposit.
          </p>
        ) : null}
        {!depositMissing && depositBalance !== null && depositBalance < DRIVER_SECURITY_DEPOSIT_MIN_GBP ? (
          <>
            <div className="dh__depositWarn" role="note">
              <div className="dh__depositWarnRow">
                <span className="dh__depositWarnIcon" aria-hidden>
                  <IconWarn />
                </span>
                <div>
                  <p className="dh__depositWarnTitle">Security deposit is {formatGBP(depositBalance)}</p>
                  <p className="dh__depositWarnSub">
                    You need at least {formatGBP(DRIVER_SECURITY_DEPOSIT_MIN_GBP)} to go online and accept jobs.
                  </p>
                </div>
              </div>
              <button type="button" className="dh__walletBtn" onClick={() => navigate('/driver/wallet')}>
                Open Wallet
              </button>
            </div>
            <div className="dh__depositAlert" role="alert">
              <span className="dh__depositAlertIcon" aria-hidden>
                <IconWarnSmall />
              </span>
              <p className="dh__depositAlertText">
                Your deposit is below the minimum of {formatGBP(DRIVER_SECURITY_DEPOSIT_MIN_GBP)}. Top up in Wallet before
                going online.
              </p>
            </div>
          </>
        ) : null}

        {loadErr ? (
          <p className="dh__alert dh__alert--error" role="alert">
            {loadErr}
          </p>
        ) : null}
        {actionMsg ? (
          <p className="dh__alert dh__alert--error" role="status">
            {actionMsg}
          </p>
        ) : null}

        {online &&
          visibleOffers.map((offer) => {
            const k = offerKey(offer);
            const busy = busyKey === k;
            const secLeft = offerSecondsLeft(offer.id);
            const pct = (secLeft / 60) * 100;
            const urgent = secLeft <= 10;
            return (
              <div key={k} className="dh-offerCard" role="region" aria-label={`New ${kindLabel(offer.kind)} request`}>
                <header className="dh-offerCard__head">
                  <div className="dh-offerCard__headMain">
                    <p className="dh-offerCard__ref">{offer.ref}</p>
                    <p className="dh-offerCard__when">{formatOfferTime(offer.created_at)}</p>
                  </div>
                  <span className={`dh-offerCard__badge dh-offerCard__badge--${offer.kind}`}>{kindLabel(offer.kind)}</span>
                </header>

                <div className="dh-offerCard__route">
                  <div className="dh-offerCard__stop dh-offerCard__stop--pick">
                    <span className="dh-offerCard__pin" aria-hidden>
                      <OfferPinPickup />
                    </span>
                    <div className="dh-offerCard__stopBody">
                      <span className="dh-offerCard__stopLbl">Pickup</span>
                      <p className="dh-offerCard__addr">{offer.from}</p>
                    </div>
                  </div>
                  <div className="dh-offerCard__rail" aria-hidden />
                  <div className="dh-offerCard__stop dh-offerCard__stop--drop">
                    <span className="dh-offerCard__pin" aria-hidden>
                      <OfferPinDrop />
                    </span>
                    <div className="dh-offerCard__stopBody">
                      <span className="dh-offerCard__stopLbl">Drop-off</span>
                      <p className="dh-offerCard__addr">{offer.to}</p>
                    </div>
                  </div>
                </div>

                <p className="dh-offerCard__dist">
                  <span className="dh-offerCard__distIcon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                      <path
                        d="M4 12h3l2 7 4-14 2 7h5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span>
                    {offer.dist}
                    {offer.dist && offer.eta ? ' · ' : null}
                    {offer.eta}
                  </span>
                </p>

                <p className="dh-offerCard__pkg" role="status">
                  {offer.pkg}
                </p>

                {offer.customerPayment && offer.customerPayment !== '—' ? (
                  <div className="dh-offerCard__pay" role="status">
                    <span className="dh-offerCard__payLbl">Payment</span>
                    <span className="dh-offerCard__payVal">{offer.customerPayment}</span>
                  </div>
                ) : null}

                <div className="dh-offerCard__priceBand">
                  <span className="dh-offerCard__priceLbl">Offer</span>
                  <p className="dh-offerCard__amt">{formatGBP(offer.amount)}</p>
                </div>

                <div className={`dh-offerCard__timer${urgent ? ' dh-offerCard__timer--urgent' : ''}`}>
                  <span className="dh-offerCard__timerTxt">Respond in {secLeft}s</span>
                  <div className="dh-offerCard__pb" aria-hidden>
                    <div className="dh-offerCard__pbFill" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="dh-offerCard__actions" role="group" aria-label="Accept or reject">
                  <button
                    type="button"
                    className="dh-offerCard__btn dh-offerCard__btn--acc"
                    disabled={busy || secLeft <= 0 || acceptBlocked}
                    onClick={() => onAccept(offer)}
                  >
                    {busy ? '…' : acceptBlocked ? 'Deposit required' : 'Accept'}
                  </button>
                  <button type="button" className="dh-offerCard__btn dh-offerCard__btn--rej" disabled={busy || secLeft <= 0} onClick={() => onReject(offer)}>
                    Reject
                  </button>
                </div>
              </div>
            );
          })}

        <section className="dh__recentSec" aria-label="Recent work">
          <h2 className="dh__secH">Your Recent Jobs</h2>
          {recent.length === 0 ? (
            <div className="dh__recentEmpty">
              <IconRecentEmpty />
              <p className="dh__recentEmptyTx">
                No accepted jobs yet. When you accept a booking, it appears here.
              </p>
            </div>
          ) : (
            <div className="dh__recentList">
              {recent.map((r) => {
                const tone = recentJobTone(r.st);
                return (
                  <div key={`${r.kind}-${r.id}`} className={`dh__recentCard dh__recentCard--${tone}`}>
                    <div className="dh__recentCard__ic">
                      <JobKindIcon kind={r.kind} />
                    </div>
                    <div className="dh__recentCard__body">
                      <span className="dh__recentCard__ref">{r.ref}</span>
                      <p className="dh__recentCard__addr">{titleCasePlaceLine(r.to)}</p>
                      <span className={`dh__recentCard__bd dh__recentCard__bd--${tone}`}>
                        {kindLabel(r.kind)} · {r.st}
                      </span>
                    </div>
                    <div className="dh__recentCard__meta">
                      <p className="dh__recentCard__amt">{formatGBP(r.amt)}</p>
                      <p className="dh__recentCard__when">{formatOfferTime(r.t)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {!loadErr && online && visibleOffers.length === 0 && offers.length > 0 && (
          <p className="dh__recentFoot">
            No offers in your 60-second window right now. New bookings will appear when customers book — respond
            quickly.
          </p>
        )}
        {!loadErr && online && offers.length === 0 && (
          <p className="dh__recentFoot">
            No open customer bookings right now. Delivery orders (placed), taxi rides, and Tuk-Tuk requests show here
            when customers book.
          </p>
        )}
        {!online && <p className="dh__pEm">Go online to see new requests in this area.</p>}
      </div>
    </div>
  );
}
