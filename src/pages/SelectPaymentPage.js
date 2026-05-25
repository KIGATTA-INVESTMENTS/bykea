import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import {
  buildCustomerDeliveryOrderRow,
  deliveryOrderDisplayRef,
} from '../lib/customerDeliveryOrderPayload';
import { getCustomerSession } from '../lib/customerSession';
import { writeShopOrderConfirmationState } from '../lib/shopOrderConfirmationSession';
import { postLocalPaynowInitiate, resolveShopPaynowLocalInitiateUrl } from '../lib/shopPaynowLocal';
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

function IconPaynow() {
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

export default function SelectPaymentPage() {
  const navigate = useNavigate();
  const { state: order = {} } = useLocation();
  const paynowConfigured = useMemo(() => Boolean(resolveShopPaynowLocalInitiateUrl()), []);
  const stripeConfigured = useMemo(() => isStripePaymentsConfigured(), []);
  const showPaymentMethods = paynowConfigured || stripeConfigured;
  const preferred = order?.preferredPayment;
  const [method, setMethod] = useState(() => {
    let p =
      preferred === 'cod' || preferred === 'ecocash' || preferred === 'card' || preferred === 'stripe'
        ? preferred
        : 'cod';
    if (p === 'ecocash') p = 'cod';
    if (p === 'card' && !paynowConfigured) p = stripeConfigured ? 'stripe' : 'cod';
    if (p === 'stripe' && !stripeConfigured) p = paynowConfigured ? 'card' : 'cod';
    if (!paynowConfigured && !stripeConfigured) return 'cod';
    return p;
  });
  const [placing, setPlacing] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const methodRows = useMemo(() => {
    const rows = [{ id: 'cod', label: 'Cash on delivery', Icon: IconCash, balance: null }];
    if (paynowConfigured) rows.push({ id: 'card', label: 'Paynow', Icon: IconPaynow, balance: null });
    if (stripeConfigured) rows.push({ id: 'stripe', label: 'Card', Icon: IconStripeCard, balance: null });
    return rows;
  }, [paynowConfigured, stripeConfigured]);

  useEffect(() => {
    if (method === 'card' && !paynowConfigured) setMethod(stripeConfigured ? 'stripe' : 'cod');
    if (method === 'stripe' && !stripeConfigured) setMethod(paynowConfigured ? 'card' : 'cod');
  }, [method, paynowConfigured, stripeConfigured]);

  const total = typeof order.priceNum === 'number' ? order.priceNum : 2.5;
  const priceStr = formatGBP(total);

  const placeOrder = async (e) => {
    e.preventDefault();
    setSubmitError('');

    const session = getCustomerSession();
    const row = buildCustomerDeliveryOrderRow(order, method === 'stripe' ? 'stripe' : method);
    if (method === 'stripe') {
      row.payment_gateway = 'stripe';
      row.payment_status = 'pending';
    }

    if (method === 'card' && paynowConfigured) {
      if (!isSupabaseConfigured || !supabase) {
        setSubmitError('Paynow requires Supabase to be configured.');
        return;
      }
    }
    if (method === 'stripe' && stripeConfigured) {
      if (!isSupabaseConfigured || !supabase) {
        setSubmitError('Card payment requires Supabase to be configured.');
        return;
      }
    }

    let supabaseOrderId = null;
    let displayOrderId = 'ING-00234';

    if (isSupabaseConfigured && supabase) {
      setPlacing(true);
      try {
        const { data, error } = await supabase
          .from('customer_delivery_orders')
          .insert(row)
          .select('id')
          .single();
        if (error) {
          setSubmitError(error.message || 'Could not save your order.');
          setPlacing(false);
          return;
        }
        supabaseOrderId = data?.id ?? null;
        if (supabaseOrderId) {
          displayOrderId = deliveryOrderDisplayRef(supabaseOrderId);
        }

        if (method === 'stripe' && stripeConfigured && supabaseOrderId) {
          const confirmState = {
            ...order,
            orderId: displayOrderId,
            supabaseOrderId,
            placedAt: new Date().toISOString(),
            priceLabel: priceStr,
            priceNum: total,
            from: order.from,
            to: order.to,
            deliveryTitle: order.deliveryTitle || 'Delivery',
            eta: order.eta || 'Varies by route',
            package: order.package,
            customer: session
              ? {
                  fullName: session.full_name || session.name || '',
                  phone: session.phone || '',
                  email: session.email || '',
                  address: order.to || '',
                }
              : undefined,
          };
          setStripeHostedReturnContext({ flow: 'order_confirmation', state: confirmState });
          const go = await stripeHostedCheckoutRedirect({
            orderKind: 'delivery',
            orderId: supabaseOrderId,
            cancelPath: '/stripe-cancel',
          });
          if (!go.ok) {
            await supabase.from('customer_delivery_orders').delete().eq('id', supabaseOrderId);
            setSubmitError(go.error || 'Could not start card checkout.');
            setPlacing(false);
          }
          return;
        }

        if (method === 'card' && paynowConfigured && supabaseOrderId) {
          const payRes = await postLocalPaynowInitiate({
            orderKind: 'delivery',
            orderNumber: displayOrderId,
            orderId: supabaseOrderId,
            amount: Number(Number(total).toFixed(2)),
            customerEmail: session?.email != null ? String(session.email) : '',
            customerPhone: session?.phone != null ? String(session.phone) : '',
            customerName:
              String(session?.full_name || session?.name || '')
                .trim()
                .slice(0, 120) || 'Customer',
          });
          if (!payRes.ok || !payRes.redirectUrl) {
            setSubmitError(payRes.error || 'Could not start Paynow.');
            setPlacing(false);
            return;
          }
          writeShopOrderConfirmationState({
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
            package: order.package,
            customer: session
              ? {
                  fullName: session.full_name || session.name || '',
                  phone: session.phone || '',
                  email: session.email || '',
                  address: order.to || '',
                }
              : undefined,
          });
          window.location.href = payRes.redirectUrl;
          return;
        }
      } catch {
        setSubmitError('Network error while placing order.');
        setPlacing(false);
        return;
      }
      setPlacing(false);
    }

    navigate('/order-confirmation', {
      replace: true,
      state: {
        ...order,
        orderId: displayOrderId,
        supabaseOrderId,
        placedAt: new Date().toISOString(),
        priceLabel: priceStr,
        priceNum: total,
        from: order.from,
        to: order.to,
      },
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
          {showPaymentMethods ? (
            <div className="pay-list" role="radiogroup" aria-label="Payment method">
              {methodRows.map((m) => {
                const isOn = method === m.id;
                const I = m.Icon;
                return (
                  <label
                    key={m.id}
                    className={`pay-row${isOn ? ' pay-row--on' : ''}`}
                    htmlFor={`pay-${m.id}`}
                  >
                    <span className="pay-row__icon" aria-hidden>
                      <I />
                    </span>
                    <span className="pay-row__body">
                      <span className="pay-row__label">{m.label}</span>
                      {m.balance ? <span className="pay-row__sub">Balance: {m.balance}</span> : null}
                    </span>
                    <input
                      type="radio"
                      id={`pay-${m.id}`}
                      name="payment"
                      className="pay-row__radio"
                      checked={isOn}
                      onChange={() => setMethod(m.id)}
                      disabled={placing}
                    />
                  </label>
                );
              })}
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
        <button type="submit" className="pay-btn" disabled={placing}>
          {placing ? 'Placing…' : method === 'stripe' ? 'Continue with card' : 'Place Order'}
        </button>
      </div>
    </form>
  );
}
