import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { deliveryFeeFromSettings, fetchShopDeliverySettings } from '../lib/shopDeliverySettings';
import { saveShopCustomerOrder } from '../lib/shopCustomerOrderSave';
import { writeShopOrderConfirmationState } from '../lib/shopOrderConfirmationSession';
import { postLocalPaynowInitiate, resolveShopPaynowLocalInitiateUrl } from '../lib/shopPaynowLocal';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './shopCheckoutPremium.css';

function useShopPaynowConfig() {
  return useMemo(() => {
    const localInitiateUrl = resolveShopPaynowLocalInitiateUrl();
    return {
      available: !!localInitiateUrl,
      localInitiateUrl,
    };
  }, []);
}

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

export default function ShopCheckoutPage() {
  const navigate = useNavigate();
  const shopPaynow = useShopPaynowConfig();
  const stripeShop = useMemo(() => isStripePaymentsConfigured(), []);
  const { items, subtotal, clearCart } = useShopCart();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(0);

  useEffect(() => {
    if (items.length === 0) {
      navigate('/shop/cart', { replace: true });
    }
  }, [items.length, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured || !supabase) {
        setDeliveryFee(0);
        return;
      }
      const { data, error: qErr } = await fetchShopDeliverySettings(supabase);
      if (cancelled) return;
      if (qErr || !data) {
        setDeliveryFee(0);
        return;
      }
      setDeliveryFee(deliveryFeeFromSettings(data));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grandTotal = subtotal + deliveryFee;

  useEffect(() => {
    if (paymentMethod === 'paynow' && !shopPaynow.available) {
      setPaymentMethod(stripeShop ? 'stripe' : 'cod');
    }
    if (paymentMethod === 'stripe' && !stripeShop) {
      setPaymentMethod(shopPaynow.available ? 'paynow' : 'cod');
    }
  }, [paymentMethod, shopPaynow.available, stripeShop]);

  const submitLabel = submitting
    ? paymentMethod === 'paynow'
      ? 'Starting payment…'
      : paymentMethod === 'stripe'
        ? 'Preparing card payment…'
        : 'Placing order…'
    : paymentMethod === 'paynow' && shopPaynow.available
      ? 'Continue to Paynow'
      : paymentMethod === 'stripe' && stripeShop
        ? 'Continue with card'
        : 'Place order';

  const onSubmit = async (e) => {
    e.preventDefault();
    const name = fullName.trim();
    const ph = phone.trim();
    const addr = address.trim();
    if (!name || !ph || !addr) {
      setError('Please enter your full name, phone number, and delivery address.');
      return;
    }
    setError('');

    if (!isSupabaseConfigured || !supabase) {
      setError('Orders are saved to Supabase. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY, then run supabase/shop_customer_orders.sql.');
      return;
    }

    const customer = {
      fullName: name,
      phone: ph,
      email: email.trim(),
      address: addr,
      notes: notes.trim(),
    };

    setSubmitting(true);
    const { data, error: saveErr } = await saveShopCustomerOrder({
      items,
      customer,
      subtotal,
      deliveryFee,
    });

    if (saveErr || !data) {
      setSubmitting(false);
      setError(saveErr?.message || 'Could not place order. Try again.');
      return;
    }

    const itemCount = items.reduce((s, l) => s + l.qty, 0);
    const paynowBody = {
      orderKind: 'shop',
      orderNumber: data.order_number,
      orderId: data.id,
      amount: grandTotal,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerName: customer.fullName,
    };

    if (stripeShop && paymentMethod === 'stripe') {
      const confirmState = {
        source: 'shop',
        orderId: data.order_number,
        shopOrderDbId: data.id,
        customer,
        priceNum: grandTotal,
        priceLabel: FMT.format(grandTotal),
        from: 'Shop partners',
        to: addr,
        deliveryTitle: 'Shop delivery',
        eta: '30–45 mins',
        placedAt: data.placed_at || new Date().toISOString(),
        package: { type: 'Shop order', size: `${itemCount} item${itemCount === 1 ? '' : 's'}` },
      };
      setStripeHostedReturnContext({ flow: 'order_confirmation', state: confirmState });
      const go = await stripeHostedCheckoutRedirect({
        orderKind: 'shop',
        orderId: data.id,
        cancelPath: '/stripe-cancel',
      });
      if (!go.ok) {
        try {
          if (supabase) await supabase.from('shop_customer_orders').delete().eq('id', data.id);
        } catch {
          // ignore
        }
        setError(go.error || 'Could not start card checkout.');
      }
      setSubmitting(false);
      return;
    }

    if (shopPaynow.available && paymentMethod === 'paynow') {
      const payRes = await postLocalPaynowInitiate(paynowBody);
      if (!payRes.ok || !payRes.redirectUrl) {
        setError(payRes.error || 'Could not start Paynow.');
        setSubmitting(false);
        return;
      }
      clearCart();
      writeShopOrderConfirmationState({
        source: 'shop',
        orderId: data.order_number,
        shopOrderDbId: data.id,
        customer,
        priceNum: grandTotal,
        priceLabel: FMT.format(grandTotal),
        from: 'Shop partners',
        to: addr,
        deliveryTitle: 'Shop delivery',
        eta: '30–45 mins',
        placedAt: data.placed_at || new Date().toISOString(),
        package: { type: 'Shop order', size: `${itemCount} item${itemCount === 1 ? '' : 's'}` },
      });
      window.location.href = payRes.redirectUrl;
      return;
    }

    setSubmitting(false);
    clearCart();
    const confirmState = {
      source: 'shop',
      orderId: data.order_number,
      shopOrderDbId: data.id,
      customer,
      priceNum: grandTotal,
      priceLabel: FMT.format(grandTotal),
      from: 'Shop partners',
      to: addr,
      deliveryTitle: 'Shop delivery',
      eta: '30–45 mins',
      placedAt: data.placed_at || new Date().toISOString(),
      package: { type: 'Shop order', size: `${itemCount} item${itemCount === 1 ? '' : 's'}` },
    };
    writeShopOrderConfirmationState(confirmState);
    navigate('/order-confirmation', { state: confirmState });
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="cko-page" role="main" aria-label="Checkout">
      <header className="cko-nav">
        <button type="button" className="cko-nav__back" onClick={() => navigate('/shop/cart')} aria-label="Back to cart">
          <BackArrow />
        </button>
        <h1 className="cko-nav__title">Checkout</h1>
        <span aria-hidden />
      </header>

      <form className="cko-form" onSubmit={onSubmit}>
        <div className="cko-scroll">
          <p className="cko-lead">Enter your details to place your shop order.</p>

          <section className="cko-card" aria-label="Order summary">
            <h2 className="cko-card__title">Order summary</h2>
            <ul className="cko-lines">
              {items.map((l) => (
                <li key={l.id} className="cko-line">
                  <span className="cko-line__name">
                    {l.name}
                    <span className="cko-line__qty">
                      {' '}
                      ×
                      {l.qty}
                    </span>
                  </span>
                  <span className="cko-line__price">{FMT.format(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="cko-row">
              <span>Subtotal</span>
              <span>{FMT.format(subtotal)}</span>
            </div>
            <div className="cko-row">
              <span>Delivery</span>
              <span>{FMT.format(deliveryFee)}</span>
            </div>
            <div className="cko-row cko-row--total">
              <span>Total</span>
              <span>{FMT.format(grandTotal)}</span>
            </div>
          </section>

          <section className="cko-card" aria-label="Your details">
            <h2 className="cko-card__title">Your details</h2>

            <div className="cko-field">
              <label className="cko-label" htmlFor="cko-name">
                Full name
                <span className="cko-req" aria-hidden>
                  {' '}
                  *
                </span>
              </label>
              <input
                id="cko-name"
                className="cko-input"
                name="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                placeholder="As on your ID"
                required
              />
            </div>

            <div className="cko-field">
              <label className="cko-label" htmlFor="cko-phone">
                Phone
                <span className="cko-req" aria-hidden>
                  {' '}
                  *
                </span>
              </label>
              <input
                id="cko-phone"
                className="cko-input"
                name="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="+44 7700 900123"
                required
              />
            </div>

            <div className="cko-field">
              <label className="cko-label" htmlFor="cko-email">
                Email
              </label>
              <input
                id="cko-email"
                className="cko-input"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div className="cko-field">
              <label className="cko-label" htmlFor="cko-address">
                Delivery address
                <span className="cko-req" aria-hidden>
                  {' '}
                  *
                </span>
              </label>
              <textarea
                id="cko-address"
                className="cko-textarea"
                name="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="street-address"
                placeholder="House / street, area, city"
                rows={3}
                required
              />
            </div>

            <div className="cko-field">
              <label className="cko-label" htmlFor="cko-notes">
                Notes for delivery (optional)
              </label>
              <textarea
                id="cko-notes"
                className="cko-textarea cko-textarea--sm"
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Gate code, landmark, etc."
                rows={2}
              />
            </div>
          </section>

          {shopPaynow.available || stripeShop ? (
            <section className="cko-card" aria-label="Payment method">
              <h2 className="cko-card__title">Payment</h2>
              <fieldset className="cko-pay-list">
                <legend className="cko-sr-only">Payment method</legend>
                <label className="cko-pay-opt">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="cod"
                    checked={paymentMethod === 'cod'}
                    onChange={() => setPaymentMethod('cod')}
                  />
                  <span className="cko-pay-opt__body">
                    <span className="cko-pay-opt__label">Cash on delivery</span>
                    <span className="cko-pay-opt__sub">Pay when your order arrives</span>
                  </span>
                </label>
                {shopPaynow.available ? (
                  <label className="cko-pay-opt">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="paynow"
                      checked={paymentMethod === 'paynow'}
                      onChange={() => setPaymentMethod('paynow')}
                    />
                    <span className="cko-pay-opt__body">
                      <span className="cko-pay-opt__label">Paynow</span>
                      <span className="cko-pay-opt__sub">EcoCash, card, or other enabled methods</span>
                    </span>
                  </label>
                ) : null}
                {stripeShop ? (
                  <label className="cko-pay-opt">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="stripe"
                      checked={paymentMethod === 'stripe'}
                      onChange={() => setPaymentMethod('stripe')}
                    />
                    <span className="cko-pay-opt__body">
                      <span className="cko-pay-opt__label">Card</span>
                      <span className="cko-pay-opt__sub">Secure checkout on Stripe</span>
                    </span>
                  </label>
                ) : null}
              </fieldset>
            </section>
          ) : null}

          {error ? (
            <p className="cko-err" role="alert">
              {error}
            </p>
          ) : null}

          {shopPaynow.available && paymentMethod === 'paynow' ? (
            <p className="cko-fine">You will be redirected to Paynow to complete payment.</p>
          ) : null}
          {stripeShop && paymentMethod === 'stripe' ? (
            <p className="cko-fine">You will be redirected to a secure page to pay by card.</p>
          ) : null}

          <Link to="/shop/cart" className="cko-back-link">
            ← Back to cart
          </Link>
        </div>

        <div className="cko-footer">
          <button type="submit" className="cko-submit" disabled={submitting}>
            {submitting ? submitLabel : `${submitLabel} · ${FMT.format(grandTotal)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
