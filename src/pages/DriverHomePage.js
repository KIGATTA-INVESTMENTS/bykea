import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import GoogleMapEmbed from '../components/GoogleMapEmbed';
import LiveUserGoogleMap from '../components/LiveUserGoogleMap';
import { useDriverOffers } from '../components/driver/DriverOffersProvider';
import { useLiveLocation } from '../hooks/useLiveLocation';
import { useThrottledMapEmbedSrc } from '../hooks/useThrottledMapEmbedSrc';
import {
  driverAcceptOffer,
  driverRejectOffer,
  fetchRecentForDriver,
  formatOfferTime,
  isCashCustomerPayment,
  isOpenBookingRowFresh,
  isWalletCustomerPayment,
  offerToActiveDeliveryOrder,
  openOfferSecondsLeft,
  OPEN_OFFER_MAX_AGE_MS,
  OFFER_RING_CYCLE_MS,
  ORDER_ALREADY_ACCEPTED_MSG,
} from '../lib/driverIncomingBookings';
import { driverPlaceBid } from '../lib/bookingBids';
import { formatGBP } from '../lib/currency';
import { DEFAULT_MAP_FALLBACK, publicViewMapUrlDriver, trustedMapCenter } from '../lib/googleMapsConfig';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { unlockDriverOfferAudio } from '../lib/driverOfferRing';
import { publishDriverOnlineLocation } from '../lib/nearbyDrivers';
import CarIcon from '../components/icons/CarIcon';
import { LOGIN_HERO_ART } from '../lib/ingoLogo';
import DriverPermissionPrompts from '../components/driver/DriverPermissionPrompts';
import './driverPortal.css';
import './driverHomePremium.css';

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
  const live = useLiveLocation({ mapThrottleMs: 12000, movePublishMeters: 80 });
  const {
    online,
    setOnline,
    offers,
    recent,
    setRecent,
    loadErr,
    ringingOfferKeys,
    driverId,
    driverVehicleType,
    driverRegisteredAt,
    removeOfferLocally,
    refreshOffers,
    setTakenNotice,
  } = useDriverOffers();

  const [jsMapFailed, setJsMapFailed] = useState(false);
  const driverMapSrc = useMemo(() => {
    const c = trustedMapCenter(live.mapCenter);
    // Quantize ~11m so tiny GPS noise does not rebuild the embed URL.
    const lat = Number(Number(c.lat).toFixed(4));
    const lng = Number(Number(c.lng).toFixed(4));
    return publicViewMapUrlDriver(lat, lng, 14);
  }, [live.mapCenter]);
  const stableDriverMapSrc = useThrottledMapEmbedSrc(driverMapSrc, { throttleMs: 20000 });
  const mapCenter = useMemo(() => trustedMapCenter(live.mapCenter), [live.mapCenter]);
  const jsMapAvailable = !jsMapFailed;
  const liveRef = useRef(live);
  liveRef.current = live;

  const [actionMsg, setActionMsg] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [bidModeKey, setBidModeKey] = useState('');
  const [bidDraft, setBidDraft] = useState('');
  const [myBids, setMyBids] = useState({});
  const acceptingRef = useRef(false);
  /** Re-render every second for countdown / expiry */
  const [, setSecTick] = useState(0);

  useEffect(() => {
    if (!driverId || !isSupabaseConfigured || !supabase) return undefined;
    if (!online) {
      void publishDriverOnlineLocation(supabase, driverId, null, null, false);
      return undefined;
    }
    const push = () => {
      const { lat, lng, hasFix } = liveRef.current;
      if (!hasFix || lat == null || lng == null) {
        void publishDriverOnlineLocation(supabase, driverId, null, null, true);
        return;
      }
      void publishDriverOnlineLocation(supabase, driverId, lat, lng, true);
    };
    push();
    const id = window.setInterval(push, 15_000);
    return () => {
      window.clearInterval(id);
      void publishDriverOnlineLocation(supabase, driverId, null, null, false);
    };
  }, [driverId, online]);

  useEffect(() => {
    if (!online) return undefined;
    const id = window.setInterval(() => setSecTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [online]);

  const visibleOffers = !online
    ? []
    : offers.filter(
        (o) =>
          o.id &&
          isOpenBookingRowFresh(o.raw || { created_at: o.created_at, assigned_driver_id: null }, driverRegisteredAt),
      );

  const recentTotal = useMemo(() => recent.reduce((s, r) => s + (Number(r.amt) || 0), 0), [recent]);

  const offerKey = (o) => `${o.table}:${o.id}`;

  const handleOnlineSwitch = useCallback(() => {
    setActionMsg('');
    unlockDriverOfferAudio();
    setOnline((was) => !was);
  }, [setOnline]);

  const onAccept = useCallback(
    async (offer) => {
      if (!supabase || !driverId) return;
      const k = offerKey(offer);
      if (acceptingRef.current || busyKey) return;
      acceptingRef.current = true;
      setBusyKey(k);
      setActionMsg('');
      const res = await driverAcceptOffer(supabase, offer, driverId, driverVehicleType);
      setBusyKey('');
      acceptingRef.current = false;
      if (!res.ok) {
        if (/already accepted/i.test(String(res.error || ''))) {
          removeOfferLocally(offer.table, offer.id);
          setTakenNotice?.(res.error || ORDER_ALREADY_ACCEPTED_MSG);
          void refreshOffers();
          return;
        }
        setActionMsg(res.error || 'Could not send offer.');
        return;
      }

      // Parcel / taxi / tuk: offer stays pending until the customer chooses this driver.
      if (res.pending) {
        const fare = Number(res.fare);
        if (Number.isFinite(fare) && fare > 0) {
          setMyBids((prev) => ({ ...prev, [k]: fare }));
        }
        setActionMsg(
          `Offer of ${formatGBP(Number.isFinite(fare) && fare > 0 ? fare : offer.amount)} sent — waiting for the customer to choose you (more than one driver has seen this request).`,
        );
        void refreshOffers();
        return;
      }

      // Shop (and any legacy instant-claim path): go straight to active delivery.
      removeOfferLocally(offer.table, offer.id);
      const rec = await fetchRecentForDriver(supabase, driverId);
      setRecent(rec);
      navigate('/driver/active-delivery', { state: { order: offerToActiveDeliveryOrder(offer) } });
    },
    [busyKey, driverId, driverVehicleType, navigate, refreshOffers, removeOfferLocally, setRecent, setTakenNotice],
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
      removeOfferLocally(offer.table, offer.id);
    },
    [driverId, removeOfferLocally],
  );

  const onBid = useCallback(
    async (offer) => {
      if (!supabase || !driverId) return;
      const k = offerKey(offer);
      const amount = Number(bidDraft);
      if (!Number.isFinite(amount) || amount <= 0) {
        setActionMsg('Enter a valid bid amount.');
        return;
      }
      setBusyKey(k);
      setActionMsg('');
      const table = offer.table;
      if (!['customer_delivery_orders', 'taxi_bookings', 'tuk_tuk_bookings'].includes(table)) {
        setBusyKey('');
        setActionMsg('Bidding is not available for this job type.');
        return;
      }
      const res = await driverPlaceBid(supabase, table, offer.id, driverId, amount);
      setBusyKey('');
      if (!res.ok) {
        if (/already accepted/i.test(String(res.error || ''))) {
          removeOfferLocally(offer.table, offer.id);
          setTakenNotice?.(res.error || ORDER_ALREADY_ACCEPTED_MSG);
          return;
        }
        setActionMsg(res.error || 'Could not place bid.');
        return;
      }
      if (res.claimed) {
        removeOfferLocally(offer.table, offer.id);
        const rec = await fetchRecentForDriver(supabase, driverId);
        setRecent(rec);
        navigate('/driver/active-delivery', { state: { order: offerToActiveDeliveryOrder(offer) } });
        return;
      }
      setBidModeKey('');
      setBidDraft('');
      setMyBids((prev) => ({ ...prev, [k]: res.amount }));
      setActionMsg(`Bid of ${formatGBP(res.amount)} sent — waiting for the customer to choose you.`);
      void refreshOffers();
    },
    [driverId, bidDraft, navigate, refreshOffers, removeOfferLocally, setRecent, setTakenNotice],
  );

  return (
    <div className="dh dh--premium" role="main" aria-label="Driver home">
      <div className="dh__srOnly" aria-live="assertive" aria-atomic="true">
        {ringingOfferKeys.size > 0 ? 'New delivery request — respond now.' : ''}
      </div>
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
        className={`dh__mapWrap dh__mapWrap--gmap${jsMapAvailable || stableDriverMapSrc ? ' dh__mapWrap--live' : ''}`}
        role="region"
        aria-label="Map near you"
      >
        {jsMapAvailable ? (
          <div className="dh__mapJs">
            <LiveUserGoogleMap
              mapCenter={mapCenter}
              fallbackCenter={DEFAULT_MAP_FALLBACK}
              hasFix={live.hasFix}
              accurate={live.hasFix}
              accuracyM={live.accuracy}
              onLoadError={() => setJsMapFailed(true)}
              zoomWithFix={15}
              zoomFallback={13}
              showUserLocationMarker
            />
          </div>
        ) : (
          <GoogleMapEmbed
            src={
              stableDriverMapSrc ||
              publicViewMapUrlDriver(DEFAULT_MAP_FALLBACK.lat, DEFAULT_MAP_FALLBACK.lng, 13)
            }
            title="Map near you"
            loading="eager"
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
                ? `Each request keeps showing for up to ${OPEN_OFFER_MAX_AGE_MS / 60000} minutes until a driver accepts — it re-rings every ${OFFER_RING_CYCLE_MS / 1000} seconds. Once accepted it disappears.`
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
          <div className="dh__stB dh__stB--sync" role="status" aria-label="Offers refresh about every 2 seconds">
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
            const secLeft = openOfferSecondsLeft(offer.created_at);
            const pct = (secLeft / (OFFER_RING_CYCLE_MS / 1000)) * 100;
            const urgent = secLeft <= 10;
            const isRinging = ringingOfferKeys.has(k);
            const payMethod = String(offer.raw?.payment_method || '').toLowerCase();
            const isWalletPay =
              isWalletCustomerPayment(payMethod) || isWalletCustomerPayment(offer.customerPayment);
            const isCashPay =
              isCashCustomerPayment(payMethod) || isCashCustomerPayment(offer.customerPayment);
            const payLabel = isWalletPay
              ? 'Wallet Payment'
              : isCashPay
                ? 'Cash Payment'
                : offer.customerPayment && offer.customerPayment !== '—'
                  ? offer.customerPayment
                  : null;
            return (
              <div
                key={k}
                className={`dh-offerCard${isRinging ? ' dh-offerCard--ringing' : ''}`}
                role="region"
                aria-label={`New ${kindLabel(offer.kind)} request`}
              >
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

                {payLabel ? (
                  <div
                    className={`dh-offerCard__pay${isWalletPay ? ' dh-offerCard__pay--wallet' : ''}${
                      isCashPay ? ' dh-offerCard__pay--cash' : ''
                    }`}
                    role="status"
                  >
                    <div className="dh-offerCard__payTop">
                      <span className="dh-offerCard__payLbl">Payment</span>
                      <span className="dh-offerCard__payVal">{payLabel}</span>
                    </div>
                    {isWalletPay ? (
                      <p className="dh-offerCard__payNote">
                        Customer has already paid through the Ingo Wallet. Do not collect cash.
                      </p>
                    ) : null}
                    {isCashPay ? (
                      <p className="dh-offerCard__payNote dh-offerCard__payNote--cash">
                        Collect cash from the customer at drop-off.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="dh-offerCard__priceBand">
                  <span className="dh-offerCard__priceLbl">Customer offer</span>
                  <p className="dh-offerCard__amt">{formatGBP(offer.amount)}</p>
                  {offer.minimumAmount != null && offer.minimumAmount < offer.amount ? (
                    <p className="dh-offerCard__minBid">Min. {formatGBP(offer.minimumAmount)}</p>
                  ) : offer.minimumAmount != null ? (
                    <p className="dh-offerCard__minBid">Admin minimum: {formatGBP(offer.minimumAmount)}</p>
                  ) : null}
                </div>

                {myBids[k] != null ? (
                  <div className="dh-offerCard__myBid" role="status">
                    <span className="dh-offerCard__myBidLbl">Your offer</span>
                    <span className="dh-offerCard__myBidAmt">{formatGBP(myBids[k])}</span>
                    <span className="dh-offerCard__myBidNote">Waiting for customer to choose you</span>
                  </div>
                ) : null}

                {bidModeKey === k &&
                ['customer_delivery_orders', 'taxi_bookings', 'tuk_tuk_bookings'].includes(offer.table) ? (
                  <div className="dh-offerCard__bidForm">
                    <label className="dh-offerCard__bidLbl" htmlFor={`bid-${k}`}>
                      Your counter-offer (min {formatGBP(Math.max(offer.minimumAmount || 0, offer.amount))})
                    </label>
                    <input
                      id={`bid-${k}`}
                      type="number"
                      step="0.5"
                      min={Math.max(offer.minimumAmount || 0, offer.amount)}
                      className="dh-offerCard__bidInput"
                      value={bidDraft}
                      onChange={(e) => setBidDraft(e.target.value)}
                      placeholder={String((offer.amount + 0.5).toFixed(2))}
                    />
                    <button
                      type="button"
                      className="dh-offerCard__btn dh-offerCard__btn--bid"
                      disabled={busy || secLeft <= 0}
                      onClick={() => onBid(offer)}
                    >
                      {busy ? '…' : 'Send bid'}
                    </button>
                  </div>
                ) : null}

                <div className={`dh-offerCard__timer${urgent ? ' dh-offerCard__timer--urgent' : ''}`}>
                  <span className="dh-offerCard__timerTxt">Respond in {secLeft}s</span>
                  <div className="dh-offerCard__pb" aria-hidden>
                    <div className="dh-offerCard__pbFill" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="dh-offerCard__actions" role="group" aria-label="Offer, bid, or reject">
                  <button
                    type="button"
                    className="dh-offerCard__btn dh-offerCard__btn--acc"
                    disabled={busy || secLeft <= 0}
                    onClick={() => onAccept(offer)}
                  >
                    {busy
                      ? '…'
                      : ['customer_delivery_orders', 'taxi_bookings', 'tuk_tuk_bookings'].includes(offer.table)
                        ? `Offer ${formatGBP(offer.amount)}`
                        : `Accept ${formatGBP(offer.amount)}`}
                  </button>
                  {['customer_delivery_orders', 'taxi_bookings', 'tuk_tuk_bookings'].includes(offer.table) ? (
                    <button
                      type="button"
                      className="dh-offerCard__btn dh-offerCard__btn--bidOpen"
                      disabled={busy || secLeft <= 0}
                      onClick={() => {
                        const floor = Math.max(offer.amount, myBids[k] || 0);
                        setBidModeKey(k);
                        setBidDraft(String((floor + 0.5).toFixed(2)));
                      }}
                    >
                      {myBids[k] != null ? 'Raise bid' : 'Bid higher'}
                    </button>
                  ) : null}
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
            No fresh offers right now. New bookings keep showing for up to {OPEN_OFFER_MAX_AGE_MS / 60000} minutes
            after customers place them, until a driver accepts — respond quickly.
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

      <DriverPermissionPrompts live={live} online={online} />
    </div>
  );
}
