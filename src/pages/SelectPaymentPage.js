import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import {
  buildCustomerDeliveryOrderRow,
  deliveryOrderDisplayRef,
} from '../lib/customerDeliveryOrderPayload';
import { friendlyAppUserFkError, getCustomerSession, resolveValidAppUserId } from '../lib/customerSession';
import { debitCustomerWallet, fetchCustomerWalletBalance } from '../lib/customerWallet';
import {
  computeIngoKilometreFare,
  resolveIngoVehicleFromDelivery,
} from '../lib/ingoKilometres';
import { notifyDriversOfNewOffer } from '../lib/driverOfferPushNotify';
import { postEcocashCharge } from '../lib/ecocashLocal';
import { buildLiveTrackingState } from '../lib/liveTrackingState';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './requestFlow.css';
import './pePayment.css';

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

function IconWallet() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" aria-hidden>
      <rect x="4" y="8" width="24" height="16" rx="2.5" stroke="#0A58A6" strokeWidth="1.8" fill="#e8f1fb" />
      <path d="M4 13h24" stroke="#0A58A6" strokeWidth="1.5" />
      <circle cx="22" cy="18.5" r="1.6" fill="#F18631" />
    </svg>
  );
}

function IconEcoCash() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" aria-hidden>
      <rect x="5" y="4" width="22" height="24" rx="3" fill="#ecfdf5" stroke="#059669" strokeWidth="1.7" />
      <path d="M11 12h10M11 16h7M11 20h9" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="21" cy="21" r="3.2" fill="#10b981" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" aria-hidden>
      <rect x="3" y="8" width="26" height="16" rx="2.5" fill="#eef2ff" stroke="#4338ca" strokeWidth="1.6" />
      <path d="M3 13h26" stroke="#4338ca" strokeWidth="1.5" />
      <rect x="7" y="17.5" width="8" height="2.2" rx="1" fill="#6366f1" />
      <rect x="18" y="17.5" width="7" height="2.2" rx="1" fill="#a5b4fc" />
    </svg>
  );
}

function initialPaymentMethod(order) {
  const raw = String(order?.preferredPayment || 'cod').toLowerCase();
  if (raw === 'ecocash') return 'ecocash';
  if (raw === 'stripe' || raw === 'card') return isStripePaymentsConfigured() ? 'stripe' : 'cod';
  if (raw === 'wallet') return 'wallet';
  return 'cod';
}

export default function SelectPaymentPage() {
  const navigate = useNavigate();
  const { state: order = {} } = useLocation();
  const session = getCustomerSession();
  const stripeOk = useMemo(() => isStripePaymentsConfigured(), []);
  const [paymentMethod, setPaymentMethod] = useState(() => initialPaymentMethod(order));
  const [placing, setPlacing] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState('');
  const [ecoPhone, setEcoPhone] = useState(() => String(getCustomerSession()?.phone || '').trim());

  const cashTotal = typeof order.priceNum === 'number' ? order.priceNum : 2.5;

  const ingoVehicle = useMemo(() => resolveIngoVehicleFromDelivery(order), [order]);
  const walletEligible = Boolean(ingoVehicle);
  const ingoFare = useMemo(() => {
    if (!ingoVehicle) return null;
    const km = Number(order.distanceKm);
    if (!Number.isFinite(km) || km < 0) return null;
    return computeIngoKilometreFare({ vehicle: ingoVehicle, distanceKm: km });
  }, [ingoVehicle, order.distanceKm]);

  const total =
    paymentMethod === 'wallet' && ingoFare != null ? ingoFare.fare : cashTotal;
  const priceStr = useMemo(() => formatGBP(total), [total]);
  const remainingAfter = Math.round((walletBalance - total) * 100) / 100;
  const canPayWithWallet = walletEligible && ingoFare != null && walletBalance + 0.001 >= total;

  useEffect(() => {
    if (paymentMethod === 'wallet' && !walletEligible) setPaymentMethod('cod');
    if ((paymentMethod === 'stripe' || paymentMethod === 'card') && !stripeOk) setPaymentMethod('cod');
  }, [paymentMethod, walletEligible, stripeOk]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWalletLoading(true);
      const userId = session?.id || null;
      if (!userId || !walletEligible) {
        if (!cancelled) {
          setWalletBalance(0);
          setWalletError('');
          setWalletLoading(false);
        }
        return;
      }
      const { balance, error } = await fetchCustomerWalletBalance(userId);
      if (cancelled) return;
      setWalletBalance(balance);
      setWalletError(error || '');
      setWalletLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.id, walletEligible]);

  const placeOrder = async (e) => {
    e.preventDefault();
    setSubmitError('');

    const method =
      paymentMethod === 'wallet'
        ? 'wallet'
        : paymentMethod === 'ecocash'
          ? 'ecocash'
          : paymentMethod === 'stripe' || paymentMethod === 'card'
            ? 'stripe'
            : 'cod';

    if (method === 'stripe' && !stripeOk) {
      setSubmitError('Card payments are not configured yet.');
      return;
    }

    if (method === 'wallet') {
      if (!session?.id) {
        setSubmitError('Sign in to pay with Ingo Kilometres.');
        return;
      }
      if (!walletEligible || !ingoFare) {
        setSubmitError('Ingo Kilometres is only available for bike and tuktuk deliveries.');
        return;
      }
      if (!canPayWithWallet) {
        setSubmitError('Insufficient Ingo Kilometres balance. Top up or pay with cash.');
        return;
      }
    }

    if (method === 'ecocash' && !String(ecoPhone || '').trim()) {
      setSubmitError('Enter the EcoCash mobile number that will approve payment.');
      return;
    }

    const orderForSave =
      method === 'wallet' && ingoFare
        ? {
            ...order,
            priceNum: total,
            priceLabel: formatGBP(total),
            minimumFareAmount: total,
            customerOfferAmount: total,
            priceBreakdownBase: ingoFare.minFare,
            priceBreakdownDistance: ingoFare.extraFare,
            priceBreakdownTime: 0,
            priceBreakdownService: 0,
            paymentRateType: 'ingo_kilometres',
          }
        : order;

    let row = buildCustomerDeliveryOrderRow(orderForSave, method);
    let supabaseOrderId = null;
    let displayOrderId = 'ING-00234';
    let deliveryConfirmationCode = row.delivery_confirmation_code || null;

    if (isSupabaseConfigured && supabase) {
      setPlacing(true);
      try {
        const appUserId = await resolveValidAppUserId(supabase, row.app_user_id);
        row = buildCustomerDeliveryOrderRow(orderForSave, method, appUserId);

        let { data, error } = await supabase
          .from('customer_delivery_orders')
          .insert(row)
          .select('id, delivery_confirmation_code')
          .single();

        if (error && /app_user_id_fkey|foreign key constraint.*app_user/i.test(error.message || '')) {
          if (method === 'wallet' || method === 'ecocash' || method === 'stripe') {
            setSubmitError('Your login session is out of date. Sign in again to continue.');
            return;
          }
          row = buildCustomerDeliveryOrderRow(orderForSave, method, null);
          ({ data, error } = await supabase
            .from('customer_delivery_orders')
            .insert(row)
            .select('id, delivery_confirmation_code')
            .single());
        }

        if (error) {
          if (/payment_method|payment_chk|wallet|ecocash|stripe/i.test(error.message || '')) {
            setSubmitError(
              `${friendlyAppUserFkError(error.message)} — Run supabase/customer_wallet_checkout.sql in the SQL editor.`,
            );
          } else {
            setSubmitError(friendlyAppUserFkError(error.message));
          }
          return;
        }
        supabaseOrderId = data?.id ?? null;
        if (data?.delivery_confirmation_code) {
          deliveryConfirmationCode = data.delivery_confirmation_code;
        }
        if (supabaseOrderId) {
          displayOrderId = deliveryOrderDisplayRef(supabaseOrderId);
        }

        if (method === 'wallet' && supabaseOrderId && appUserId) {
          const debit = await debitCustomerWallet({
            userId: appUserId,
            amount: total,
            label: `Delivery ${displayOrderId}`,
            refType: 'delivery',
            refId: supabaseOrderId,
          });
          if (!debit.ok) {
            try {
              await supabase.from('customer_delivery_orders').delete().eq('id', supabaseOrderId);
            } catch {
              // ignore
            }
            setSubmitError(debit.error || 'Could not pay with Ingo Kilometres.');
            return;
          }
          try {
            await supabase
              .from('customer_delivery_orders')
              .update({
                payment_status: 'paid',
                payment_completed_at: new Date().toISOString(),
                payment_gateway: 'wallet',
              })
              .eq('id', supabaseOrderId);
          } catch {
            // payment_status columns may be optional on older schemas
          }
        }

        if (method === 'ecocash' && supabaseOrderId) {
          const charge = await postEcocashCharge({
            orderId: supabaseOrderId,
            orderNumber: displayOrderId,
            amount: total,
            phone: ecoPhone,
            orderKind: 'delivery',
            customerName: session?.full_name || session?.email || 'Customer',
            remarks: `Delivery ${displayOrderId}`,
          });
          if (!charge?.ok) {
            try {
              await supabase.from('customer_delivery_orders').delete().eq('id', supabaseOrderId);
            } catch {
              // ignore
            }
            setSubmitError(charge?.error || 'Could not start EcoCash payment.');
            return;
          }

          const trackingPayload = {
            ...orderForSave,
            source: 'delivery',
            orderId: displayOrderId,
            supabaseOrderId,
            placedAt: new Date().toISOString(),
            priceLabel: priceStr,
            priceNum: total,
            from: order.from,
            to: order.to,
            deliveryTitle: order.deliveryTitle || 'Delivery',
            eta: order.eta || 'Varies by route',
            deliveryConfirmationCode,
            payment_method: 'ecocash',
            payment_status: 'pending',
          };
          const ltState = buildLiveTrackingState(trackingPayload);
          navigate('/ecocash-waiting', {
            replace: true,
            state: {
              clientCorrelation: charge.clientCorrelation,
              phone: charge.phone || ecoPhone,
              orderId: supabaseOrderId,
              orderKind: 'delivery',
              orderNumber: displayOrderId,
              notifyTable: 'customer_delivery_orders',
              nextPath: ltState ? '/live-tracking' : '/order-confirmation',
              nextState: ltState || trackingPayload,
            },
          });
          return;
        }

        if (method === 'stripe' && supabaseOrderId) {
          const trackingPayload = {
            ...orderForSave,
            source: 'delivery',
            orderId: displayOrderId,
            supabaseOrderId,
            placedAt: new Date().toISOString(),
            priceLabel: priceStr,
            priceNum: total,
            from: order.from,
            to: order.to,
            deliveryTitle: order.deliveryTitle || 'Delivery',
            eta: order.eta || 'Varies by route',
            deliveryConfirmationCode,
            payment_method: 'stripe',
            payment_status: 'pending',
          };
          const ltState = buildLiveTrackingState(trackingPayload);
          setStripeHostedReturnContext({
            flow: ltState ? 'live_tracking' : 'order_confirmation',
            state: ltState || trackingPayload,
          });
          const go = await stripeHostedCheckoutRedirect({
            orderKind: 'delivery',
            orderId: supabaseOrderId,
            cancelPath: '/stripe-cancel',
          });
          if (!go.ok) {
            try {
              await supabase.from('customer_delivery_orders').delete().eq('id', supabaseOrderId);
            } catch {
              // ignore
            }
            setSubmitError(go.error || 'Could not start card checkout.');
            return;
          }
          return;
        }

        if (supabaseOrderId && method !== 'ecocash' && method !== 'stripe') {
          notifyDriversOfNewOffer('customer_delivery_orders', supabaseOrderId);
        }
      } catch {
        setSubmitError('Network error while placing order.');
        return;
      } finally {
        setPlacing(false);
      }
    } else if (method === 'wallet' || method === 'ecocash' || method === 'stripe') {
      setSubmitError(
        method === 'ecocash'
          ? 'EcoCash requires Supabase. Configure the backend, or pay with cash.'
          : method === 'stripe'
            ? 'Card payments require Supabase. Configure the backend, or pay with cash.'
            : 'Ingo Kilometres payments require Supabase. Pay with cash, or configure the app backend.',
      );
      return;
    }

    const trackingPayload = {
      ...orderForSave,
      source: 'delivery',
      orderId: displayOrderId,
      supabaseOrderId,
      placedAt: new Date().toISOString(),
      priceLabel: priceStr,
      priceNum: total,
      from: order.from,
      to: order.to,
      deliveryTitle: order.deliveryTitle || 'Delivery',
      eta: order.eta || 'Varies by route',
      deliveryConfirmationCode,
      payment_method: method,
    };
    const ltState = buildLiveTrackingState(trackingPayload);
    navigate(ltState ? '/live-tracking' : '/order-confirmation', {
      replace: true,
      state: ltState || trackingPayload,
    });
  };

  return (
    <form className="pay-page" onSubmit={placeOrder}>
      <div className="pay-header">
        <div className="pay-header__row">
          <Link to="/price-estimate" state={order} className="flow-back" aria-label="Back">
            <BackArrow />
          </Link>
          <h1>Select Payment</h1>
        </div>
      </div>
      <div className="pay-scroll">
        {submitError ? (
          <div
            role="alert"
            style={{
              border: '1px solid #f0c7c7',
              marginBottom: '0.75rem',
              padding: '0.65rem 0.85rem',
              borderRadius: 10,
              background: '#fff',
            }}
          >
            <p style={{ margin: 0, color: '#b42318', fontSize: '0.9rem' }}>{submitError}</p>
          </div>
        ) : null}

        <div className="pay-list" role="radiogroup" aria-label="Payment method">
          {walletEligible ? (
            <label className={paymentMethod === 'wallet' ? 'pay-row pay-row--on' : 'pay-row'} htmlFor="pay-wallet">
              <span className="pay-row__icon" aria-hidden>
                <IconWallet />
              </span>
              <span className="pay-row__body">
                <span className="pay-row__label">Pay with Ingo Kilometres</span>
                <span className="pay-row__sub">
                  {walletLoading
                    ? 'Loading balance…'
                    : ingoFare
                      ? `Balance ${formatGBP(walletBalance)} · fare ${formatGBP(ingoFare.fare)}`
                      : `Balance ${formatGBP(walletBalance)}`}
                </span>
              </span>
              <input
                type="radio"
                id="pay-wallet"
                name="payment"
                className="pay-row__radio"
                checked={paymentMethod === 'wallet'}
                onChange={() => setPaymentMethod('wallet')}
              />
            </label>
          ) : null}

          <label className={paymentMethod === 'cod' ? 'pay-row pay-row--on' : 'pay-row'} htmlFor="pay-cod">
            <span className="pay-row__icon" aria-hidden>
              <IconCash />
            </span>
            <span className="pay-row__body">
              <span className="pay-row__label">Pay with Cash</span>
              <span className="pay-row__sub">Pay the rider when your parcel arrives</span>
            </span>
            <input
              type="radio"
              id="pay-cod"
              name="payment"
              className="pay-row__radio"
              checked={paymentMethod === 'cod'}
              onChange={() => setPaymentMethod('cod')}
            />
          </label>

          <label className={paymentMethod === 'ecocash' ? 'pay-row pay-row--on' : 'pay-row'} htmlFor="pay-eco">
            <span className="pay-row__icon" aria-hidden>
              <IconEcoCash />
            </span>
            <span className="pay-row__body">
              <span className="pay-row__label">Pay with EcoCash</span>
              <span className="pay-row__sub">Approve on your phone (USD / ZWG)</span>
            </span>
            <input
              type="radio"
              id="pay-eco"
              name="payment"
              className="pay-row__radio"
              checked={paymentMethod === 'ecocash'}
              onChange={() => setPaymentMethod('ecocash')}
            />
          </label>

          {stripeOk ? (
            <label className={paymentMethod === 'stripe' ? 'pay-row pay-row--on' : 'pay-row'} htmlFor="pay-card">
              <span className="pay-row__icon" aria-hidden>
                <IconCard />
              </span>
              <span className="pay-row__body">
                <span className="pay-row__label">Pay with Card</span>
                <span className="pay-row__sub">Secure checkout on Stripe</span>
              </span>
              <input
                type="radio"
                id="pay-card"
                name="payment"
                className="pay-row__radio"
                checked={paymentMethod === 'stripe'}
                onChange={() => setPaymentMethod('stripe')}
              />
            </label>
          ) : null}
        </div>

        {paymentMethod === 'ecocash' ? (
          <div className="pay-wallet-box" aria-label="EcoCash phone">
            <h3>EcoCash number</h3>
            <label htmlFor="eco-phone" style={{ display: 'block', fontSize: '0.85rem', color: '#64748b', marginBottom: 6 }}>
              Mobile that will receive the payment prompt
            </label>
            <input
              id="eco-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0771234567"
              value={ecoPhone}
              onChange={(e) => setEcoPhone(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 46,
                borderRadius: 10,
                border: '1px solid #dbe3ef',
                padding: '0 0.85rem',
                fontSize: '1rem',
                fontFamily: 'inherit',
              }}
              required
            />
          </div>
        ) : null}

        {paymentMethod === 'wallet' && walletEligible ? (
          <div className="pay-wallet-box" aria-label="Ingo Kilometres payment summary">
            <h3>Ingo Kilometres</h3>
            <div className="pay-wallet-box__row">
              <span>Ingo Kilometre fare</span>
              <span>{priceStr}</span>
            </div>
            {ingoFare ? (
              <div className="pay-wallet-box__row">
                <span>Cash market offer</span>
                <span>{formatGBP(cashTotal)}</span>
              </div>
            ) : null}
            <div className="pay-wallet-box__row">
              <span>Current balance</span>
              <span>{walletLoading ? '…' : formatGBP(walletBalance)}</span>
            </div>
            <div className="pay-wallet-box__row pay-wallet-box__row--emph">
              <span>Remaining after trip</span>
              <span className={remainingAfter < 0 ? 'pay-wallet-box__neg' : undefined}>
                {walletLoading ? '…' : formatGBP(Math.max(0, remainingAfter))}
              </span>
            </div>
            {!walletLoading && !canPayWithWallet ? (
              <p className="pay-wallet-box__warn" role="status">
                Not enough balance. Top up or choose cash.
              </p>
            ) : null}
            {walletError ? (
              <p className="pay-wallet-box__warn" role="status">
                {walletError}
              </p>
            ) : null}
            <Link to="/wallet/top-up" className="pay-wallet-box__link">
              Top up Ingo Kilometres
            </Link>
          </div>
        ) : null}

        <div className="pay-summary" aria-label="Order summary">
          <h3>Order Summary</h3>
          <div className="pay-summary__total">
            <span>Total amount</span>
            <span className="pay-summary__val">{priceStr}</span>
          </div>
          <div className="pay-summary__row">
            <span>Delivery type</span>
            <span>{order.deliveryTitle || 'Delivery'}</span>
          </div>
          <div className="pay-summary__row">
            <span>Estimated time</span>
            <span style={{ textAlign: 'right' }}>{order.eta || '45 - 60 mins'}</span>
          </div>
        </div>
        <button
          type="submit"
          className="pay-btn"
          disabled={placing || (paymentMethod === 'wallet' && !canPayWithWallet)}
        >
          {placing
            ? paymentMethod === 'stripe'
              ? 'Preparing card…'
              : 'Placing…'
            : paymentMethod === 'wallet'
              ? `Pay ${priceStr} with Ingo Km`
              : paymentMethod === 'ecocash'
                ? `Pay ${priceStr} with EcoCash`
                : paymentMethod === 'stripe'
                  ? `Pay ${priceStr} with Card`
                  : 'Place Order'}
        </button>
      </div>
    </form>
  );
}
