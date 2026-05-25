import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import {
  buildCustomerDeliveryOrderRow,
  deliveryOrderDisplayRef,
} from '../lib/customerDeliveryOrderPayload';
import { getCustomerSession } from '../lib/customerSession';
import { deliveryPricingServiceTypeFromPackage } from '../lib/deliveryPricingServiceType';
import { estimateRoadKm, haversineKm } from '../lib/routeEstimate';
import { forwardGeocodeAddress } from '../lib/reverseGeocode';
import { postLocalPaynowInitiate, resolveShopPaynowLocalInitiateUrl } from '../lib/shopPaynowLocal';
import { writeShopOrderConfirmationState } from '../lib/shopOrderConfirmationSession';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './bookRide.css';
import './pePayment.css';

const FALLBACK_PRICE_PER_KM = 0.5;
const FALLBACK_BASE_FARE = 1.5;
const FALLBACK_SERVICE_FEE = 0.2;

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

function IconCard() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="#333" strokeWidth="1.3" aria-hidden>
      <rect x="3" y="7" width="26" height="18" rx="2" fill="#fff" />
      <path d="M3 12h26" stroke="#F18631" strokeWidth="2" />
      <rect x="5" y="18" width="7" height="2" rx="0.5" fill="#ccc" />
    </svg>
  );
}
function IconStripeCard() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
      <rect x="3" y="7" width="26" height="18" rx="2" fill="#635bff" />
      <path d="M3 12h26" fill="#0a2540" opacity="0.25" />
      <rect x="6" y="17" width="10" height="3" rx="0.5" fill="#c4f4ff" opacity="0.9" />
    </svg>
  );
}
function IconCash() {
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

function IconBike() {
  return (
    <svg viewBox="0 0 32 32" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden>
      <circle cx="8" cy="22" r="3.2" fill="none" />
      <circle cx="22" cy="22" r="3.2" fill="none" />
      <path
        d="M8 9h3l2.2 4.3L20.5 7H14M9.2 10.5L8 22M19.5 12.3L22 22M12.2 13.3L16.3 19H10"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function formatPe(n) {
  return formatGBP(n);
}

function parseDistanceKm(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  if (typeof raw === 'string' && raw.trim()) {
    const m = raw.match(/([\d.]+)/);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
  }
  return null;
}

function resolveAddresses(state, fallbackKm) {
  const from = (state && state.pickup) || 'Stratford, London E15';
  const stops = state?.stops;
  const last = Array.isArray(stops) && stops.length ? stops[stops.length - 1] : null;
  const to =
    (last && (last.value || last.address)) || (state && state.to) || 'Oxford Street, London W1';
  const dRaw = state?.distanceKm;
  const parsed = parseDistanceKm(dRaw);
  const km = parsed != null ? parsed : fallbackKm != null && fallbackKm > 0 ? fallbackKm : 4.2;
  let distance;
  if (typeof dRaw === 'number' && Number.isFinite(dRaw)) {
    distance = `${(Math.round(dRaw * 10) / 10).toFixed(1)} km`;
  } else if (typeof dRaw === 'string' && dRaw.trim()) {
    distance = dRaw.trim();
  } else if (fallbackKm != null && fallbackKm > 0) {
    distance = `${(Math.round(fallbackKm * 10) / 10).toFixed(1)} km`;
  } else {
    distance = '4.2 km';
  }
  return { from, to, distance, km };
}

export default function PriceEstimatePage() {
  const navigate = useNavigate();
  const { state: navState = {} } = useLocation();
  const [fallbackRouteKm, setFallbackRouteKm] = useState(null);

  useEffect(() => {
    const dRaw = navState?.distanceKm;
    const hasExplicit =
      (typeof dRaw === 'number' && Number.isFinite(dRaw) && dRaw > 0) ||
      (typeof dRaw === 'string' && String(dRaw).trim() !== '');
    if (hasExplicit) {
      setFallbackRouteKm(null);
      return undefined;
    }

    let cancelled = false;
    const pickup = String(navState?.pickup || '').trim();
    const stops = navState?.stops;
    const stopTexts = Array.isArray(stops)
      ? stops.map((s) => String(s?.value ?? '').trim()).filter(Boolean)
      : [];
    const drop = stopTexts[stopTexts.length - 1] || '';
    if (!pickup || !drop) {
      setFallbackRouteKm(null);
      return undefined;
    }

    (async () => {
      try {
        const a = await forwardGeocodeAddress(pickup);
        const b = await forwardGeocodeAddress(drop);
        if (cancelled || !a || !b) return;
        const middle = stopTexts.length > 1 ? stopTexts.slice(0, -1) : [];
        let straight = 0;
        let prev = { lat: a.lat, lng: a.lng };
        for (const t of middle) {
          const wp = await forwardGeocodeAddress(t);
          if (!wp) return;
          const h = haversineKm(prev.lat, prev.lng, wp.lat, wp.lng);
          if (h == null) return;
          straight += h;
          prev = { lat: wp.lat, lng: wp.lng };
        }
        const hLast = haversineKm(prev.lat, prev.lng, b.lat, b.lng);
        if (hLast == null) return;
        straight += hLast;
        const road = estimateRoadKm(straight);
        if (!cancelled && road != null && road > 0) setFallbackRouteKm(road);
      } catch {
        if (!cancelled) setFallbackRouteKm(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navState]);

  const { from, to, distance, km } = useMemo(
    () => resolveAddresses(navState, fallbackRouteKm),
    [navState, fallbackRouteKm],
  );
  const deliverySvc = useMemo(() => deliveryPricingServiceTypeFromPackage(navState), [navState]);

  const [ratesLoaded, setRatesLoaded] = useState(false);
  const [pricePerKm, setPricePerKm] = useState(FALLBACK_PRICE_PER_KM);
  const [baseFare, setBaseFare] = useState(FALLBACK_BASE_FARE);
  const [serviceFee, setServiceFee] = useState(FALLBACK_SERVICE_FEE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isSupabaseConfigured || !supabase) return;
        const pick = async (serviceType) => {
          const { data } = await supabase
            .from('service_pricing')
            .select('price_per_km, base_fare, service_fee')
            .eq('service_type', serviceType)
            .maybeSingle();
          return data;
        };
        let data = await pick(deliverySvc);
        if (!data && deliverySvc !== 'delivery') data = await pick('delivery');
        if (cancelled) return;
        const pk = data?.price_per_km != null ? Number(data.price_per_km) : NaN;
        const bf = data?.base_fare != null ? Number(data.base_fare) : NaN;
        const sf = data?.service_fee != null ? Number(data.service_fee) : NaN;
        if (Number.isFinite(pk) && pk >= 0) setPricePerKm(pk);
        if (Number.isFinite(bf) && bf >= 0) setBaseFare(bf);
        if (Number.isFinite(sf) && sf >= 0) setServiceFee(sf);
      } finally {
        if (!cancelled) setRatesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliverySvc]);

  const distanceFee = useMemo(() => km * pricePerKm, [km, pricePerKm]);
  const total = baseFare + distanceFee + serviceFee;
  const totalLabel = ratesLoaded ? formatPe(total) : '…';

  const paynowConfigured = Boolean(resolveShopPaynowLocalInitiateUrl());
  const stripeConfigured = isStripePaymentsConfigured();
  const [payChoice, setPayChoice] = useState('cod');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    if (!paynowConfigured && payChoice === 'card') setPayChoice(stripeConfigured ? 'stripe' : 'cod');
    if (!stripeConfigured && payChoice === 'stripe') setPayChoice(paynowConfigured ? 'card' : 'cod');
  }, [paynowConfigured, stripeConfigured, payChoice]);

  const mergedOrderState = useMemo(
    () => ({
      ...navState,
      deliveryOption: 'delivery',
      deliveryTitle: 'Delivery',
      priceLabel: formatPe(total),
      priceNum: total,
      priceBreakdownBase: baseFare,
      priceBreakdownDistance: distanceFee,
      priceBreakdownService: serviceFee,
      eta: 'Varies by route',
      scheduledFor: null,
      from,
      to,
      distance,
      distanceKm: km,
    }),
    [navState, baseFare, distanceFee, serviceFee, from, to, distance, km, total],
  );

  const confirm = async (e) => {
    e.preventDefault();
    setCheckoutError('');

    if (payChoice === 'cod') {
      navigate('/select-payment', {
        state: { ...mergedOrderState, preferredPayment: 'cod' },
      });
      return;
    }

    if (payChoice === 'stripe') {
      if (!isSupabaseConfigured || !supabase) {
        setCheckoutError('Connect Supabase to pay by card.');
        return;
      }
      if (!stripeConfigured) {
        setCheckoutError('Card payment is not configured for this app yet.');
        return;
      }
      setCheckoutBusy(true);
      try {
        const row = buildCustomerDeliveryOrderRow(mergedOrderState, 'stripe');
        row.payment_gateway = 'stripe';
        row.payment_status = 'pending';
        const { data, error: insErr } = await supabase
          .from('customer_delivery_orders')
          .insert(row)
          .select('id')
          .single();
        if (insErr || !data?.id) {
          setCheckoutError(insErr?.message || 'Could not save your order.');
          return;
        }
        const orderUuid = data.id;
        const displayOrderId = deliveryOrderDisplayRef(orderUuid);
        const session = getCustomerSession();
        const confirmState = {
          ...mergedOrderState,
          orderId: displayOrderId,
          supabaseOrderId: orderUuid,
          placedAt: new Date().toISOString(),
          priceLabel: formatPe(total),
          priceNum: total,
          from,
          to,
          deliveryTitle: 'Delivery',
          eta: 'Varies by route',
          package: navState.package,
          customer: session
            ? {
                fullName: session.full_name || session.name || '',
                phone: session.phone || '',
                email: session.email || '',
                address: to,
              }
            : undefined,
        };
        setStripeHostedReturnContext({ flow: 'order_confirmation', state: confirmState });
        const go = await stripeHostedCheckoutRedirect({
          orderKind: 'delivery',
          orderId: orderUuid,
          cancelPath: '/stripe-cancel',
        });
        if (!go.ok) {
          await supabase.from('customer_delivery_orders').delete().eq('id', orderUuid);
          setCheckoutError(go.error || 'Could not start card checkout.');
        }
      } finally {
        setCheckoutBusy(false);
      }
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setCheckoutError('Connect Supabase to pay with Paynow.');
      return;
    }
    if (!paynowConfigured) {
      setCheckoutError('Paynow needs the API at https://bykea-production.up.railway.app (or set REACT_APP_SHOP_PAYNOW_LOCAL_URL), or choose card.');
      return;
    }

    setCheckoutBusy(true);
    try {
      const row = buildCustomerDeliveryOrderRow(mergedOrderState, 'card');
      const { data, error: insErr } = await supabase
        .from('customer_delivery_orders')
        .insert(row)
        .select('id')
        .single();
      if (insErr || !data?.id) {
        setCheckoutError(insErr?.message || 'Could not save your order.');
        return;
      }
      const orderUuid = data.id;
      const displayOrderId = deliveryOrderDisplayRef(orderUuid);
      const session = getCustomerSession();
      const payRes = await postLocalPaynowInitiate({
        orderKind: 'delivery',
        orderNumber: displayOrderId,
        orderId: orderUuid,
        amount: Number(total.toFixed(2)),
        customerEmail: session?.email != null ? String(session.email) : '',
        customerPhone: session?.phone != null ? String(session.phone) : '',
        customerName:
          String(session?.full_name || session?.name || '')
            .trim()
            .slice(0, 120) || 'Customer',
      });
      if (!payRes.ok || !payRes.redirectUrl) {
        setCheckoutError(payRes.error || 'Could not start Paynow.');
        return;
      }
      writeShopOrderConfirmationState({
        source: 'delivery',
        orderId: displayOrderId,
        supabaseOrderId: orderUuid,
        placedAt: new Date().toISOString(),
        priceLabel: formatPe(total),
        priceNum: total,
        from,
        to,
        deliveryTitle: 'Delivery',
        eta: 'Varies by route',
        package: navState.package,
        customer: session
          ? {
              fullName: session.full_name || session.name || '',
              phone: session.phone || '',
              email: session.email || '',
              address: to,
            }
          : undefined,
      });
      window.location.href = payRes.redirectUrl;
    } finally {
      setCheckoutBusy(false);
    }
  };

  const confirmLabel = checkoutBusy
    ? 'Starting…'
    : payChoice === 'card'
      ? 'Continue to Paynow'
      : payChoice === 'stripe'
        ? 'Continue with card'
        : 'Confirm & continue';

  return (
    <form className="br-page br-page--form" onSubmit={confirm}>
      <header className="br-nav br-nav--stacked">
        <Link
          to="/package-details"
          className="br-nav__back"
          state={navState}
          replace={false}
          aria-label="Back to package details"
        >
          <BackArrow />
        </Link>
        <div className="br-nav__center">
          <h1 className="br-nav__title">Price Estimate</h1>
          <p className="br-nav__step">Step 3 of 3</p>
        </div>
        <span className="br-nav__spacer" aria-hidden />
      </header>

      <div className="br-scroll br-scroll--form">
        <section className="br-pd-card br-pe-route" aria-label="Route summary">
          <h2 className="br-pd-heading">Route</h2>
          <div className="br-loc-list br-pe-loc" role="list">
            <div className="br-loc-row br-pe-loc__row" role="listitem">
              <span className="br-loc-row__dot br-loc-row__dot--pickup" aria-hidden />
              <div className="br-loc-row__main">
                <span className="br-loc-row__label">Pickup</span>
                <p className="br-pe-loc__addr">{from}</p>
              </div>
            </div>
            <div className="br-loc-row br-pe-loc__row" role="listitem">
              <span className="br-loc-row__dot br-loc-row__dot--drop" aria-hidden />
              <div className="br-loc-row__main">
                <span className="br-loc-row__label">Drop-off</span>
                <p className="br-pe-loc__addr">{to}</p>
              </div>
            </div>
          </div>
          <p className="br-pe-distance">
            <span className="br-pe-distance__lab">Distance</span>
            <span className="br-pe-distance__val">{distance}</span>
          </p>
        </section>

        <section className="br-pd-card" aria-label="Delivery estimate">
          <h2 className="br-pd-heading">Delivery</h2>
          <div className="br-pe-service" role="group" aria-label={`Delivery total ${totalLabel}`}>
            <span className="br-pe-service__icon" aria-hidden>
              <IconBike />
            </span>
            <div className="br-pe-service__body">
              <p className="br-pe-service__title">Delivery</p>
              <p className="br-pe-service__sub">Estimated fare for your parcel</p>
            </div>
            <span className="br-pe-service__price">{totalLabel}</span>
          </div>
        </section>

        <section className="br-pd-card br-pe-pay-card" aria-label="Payment method">
          <h2 className="br-pd-heading">Payment</h2>
          <div className="pay-list br-pe-pay-list" role="radiogroup" aria-label="Payment method">
            <label className={`pay-row${payChoice === 'cod' ? ' pay-row--on' : ''}`} htmlFor="pe-pay-cod">
              <span className="pay-row__icon" aria-hidden>
                <IconCash />
              </span>
              <span className="pay-row__body">
                <span className="pay-row__label">Cash on delivery</span>
                <span className="pay-row__sub">Pay the rider when your parcel arrives</span>
              </span>
              <input
                type="radio"
                id="pe-pay-cod"
                name="pe-payment"
                className="pay-row__radio"
                checked={payChoice === 'cod'}
                onChange={() => setPayChoice('cod')}
                disabled={checkoutBusy}
              />
            </label>
            {paynowConfigured ? (
              <label className={`pay-row${payChoice === 'card' ? ' pay-row--on' : ''}`} htmlFor="pe-pay-card">
                <span className="pay-row__icon" aria-hidden>
                  <IconCard />
                </span>
                <span className="pay-row__body">
                  <span className="pay-row__label">Paynow</span>
                  <span className="pay-row__sub">Redirect to Paynow checkout</span>
                </span>
                <input
                  type="radio"
                  id="pe-pay-card"
                  name="pe-payment"
                  className="pay-row__radio"
                  checked={payChoice === 'card'}
                  onChange={() => setPayChoice('card')}
                  disabled={checkoutBusy}
                />
              </label>
            ) : null}
            {stripeConfigured ? (
              <label
                className={`pay-row${payChoice === 'stripe' ? ' pay-row--on' : ''}`}
                htmlFor="pe-pay-stripe"
              >
                <span className="pay-row__icon" aria-hidden>
                  <IconStripeCard />
                </span>
                <span className="pay-row__body">
                  <span className="pay-row__label">Card</span>
                  <span className="pay-row__sub">Pay by card (secure checkout)</span>
                </span>
                <input
                  type="radio"
                  id="pe-pay-stripe"
                  name="pe-payment"
                  className="pay-row__radio"
                  checked={payChoice === 'stripe'}
                  onChange={() => setPayChoice('stripe')}
                  disabled={checkoutBusy}
                />
              </label>
            ) : null}
          </div>
        </section>

        {checkoutError ? (
          <p className="br-pd-error" role="alert">
            {checkoutError}
          </p>
        ) : null}

        <section className="br-pd-card br-pe-breakdown" aria-label="Price breakdown">
          <h2 className="br-pd-heading">Price breakdown</h2>
          <div className="br-pe-break__row">
            <span>Base fare</span>
            <span>{ratesLoaded ? formatPe(baseFare) : '…'}</span>
          </div>
          <div className="br-pe-break__row">
            <span>Distance fee</span>
            <span>{ratesLoaded ? formatPe(distanceFee) : '…'}</span>
          </div>
          <div className="br-pe-break__row">
            <span>Service fee</span>
            <span>{ratesLoaded ? formatPe(serviceFee) : '…'}</span>
          </div>
          <hr className="br-pe-break__hr" />
          <div className="br-pe-break__row br-pe-break__row--total">
            <span>Total</span>
            <span>{totalLabel}</span>
          </div>
        </section>
      </div>

      <div className="br-footer">
        <button type="submit" className="br-confirm" disabled={!ratesLoaded || checkoutBusy}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}
