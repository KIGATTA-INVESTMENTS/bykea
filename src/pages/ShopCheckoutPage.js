import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AddressSuggestInput from '../components/AddressSuggestInput';
import { FMT_GBP as FMT, formatGBP } from '../lib/currency';
import { getCustomerSession, resolveValidAppUserId } from '../lib/customerSession';
import { debitCustomerWallet, fetchCustomerWalletBalance } from '../lib/customerWallet';
import { computeShopCartDeliveryKm } from '../lib/shopDeliveryDistance';
import { shopDeliveryFeeBreakdown } from '../lib/shopDeliveryFee';
import { fetchShopDeliverySettings } from '../lib/shopDeliverySettings';
import { saveShopCustomerOrder } from '../lib/shopCustomerOrderSave';
import { writeShopOrderConfirmationState } from '../lib/shopOrderConfirmationSession';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import { postEcocashCharge } from '../lib/ecocashLocal';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { useShopCart } from '../context/ShopCartContext';
import './shopCheckoutPremium.css';
import '../components/AddressSuggestInput.css';

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
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
  const stripeShop = useMemo(() => isStripePaymentsConfigured(), []);
  const { items, subtotal, clearCart } = useShopCart();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [addressLatLng, setAddressLatLng] = useState(null);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deliverySettings, setDeliverySettings] = useState(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryKm, setDeliveryKm] = useState(null);
  const [deliveryPerKm, setDeliveryPerKm] = useState(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryHint, setDeliveryHint] = useState('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);

  const session = getCustomerSession();
  const debouncedAddress = useDebouncedValue(address, 650);
  const shopIdsKey = useMemo(
    () => [...new Set(items.map((l) => l.shopId).filter(Boolean))].sort().join(','),
    [items],
  );

  useEffect(() => {
    if (items.length === 0) {
      navigate('/shop/cart', { replace: true });
    }
  }, [items.length, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured || !supabase) {
        setDeliverySettings(null);
        return;
      }
      const { data, error: qErr } = await fetchShopDeliverySettings(supabase);
      if (cancelled) return;
      if (qErr || !data) {
        setDeliverySettings(null);
        return;
      }
      setDeliverySettings(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const addr = debouncedAddress.trim();
    if (!isSupabaseConfigured || !supabase || !deliverySettings) {
      setDeliveryFee(0);
      setDeliveryKm(null);
      setDeliveryPerKm(null);
      setDeliveryHint('');
      setDeliveryLoading(false);
      return;
    }
    if (!addr || addr.length < 6) {
      setDeliveryFee(0);
      setDeliveryKm(null);
      setDeliveryPerKm(null);
      setDeliveryHint('Enter your delivery address to see the delivery charge.');
      setDeliveryLoading(false);
      return;
    }

    setDeliveryLoading(true);
    setDeliveryHint('');
    (async () => {
      const shopIds = shopIdsKey ? shopIdsKey.split(',') : [];
      const dist = await computeShopCartDeliveryKm(supabase, shopIds, addr, addressLatLng);
      if (cancelled) return;
      setDeliveryLoading(false);
      if (!dist.ok || dist.km == null) {
        setDeliveryFee(0);
        setDeliveryKm(null);
        setDeliveryPerKm(null);
        setDeliveryHint(dist.error || 'Could not calculate delivery distance.');
        return;
      }
      const breakdown = shopDeliveryFeeBreakdown(dist.km, deliverySettings);
      setDeliveryKm(breakdown.km);
      setDeliveryPerKm(breakdown.perKm);
      setDeliveryFee(breakdown.fee);
      setDeliveryHint(dist.warning || '');
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedAddress, shopIdsKey, deliverySettings, addressLatLng]);

  const grandTotal = subtotal + deliveryFee;
  const remainingAfter = Math.round((walletBalance - grandTotal) * 100) / 100;
  const canPayWithWallet = walletBalance + 0.001 >= grandTotal;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWalletLoading(true);
      const userId = session?.id || null;
      if (!userId) {
        if (!cancelled) {
          setWalletBalance(0);
          setWalletLoading(false);
        }
        return;
      }
      const { balance } = await fetchCustomerWalletBalance(userId);
      if (cancelled) return;
      setWalletBalance(balance);
      setWalletLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

  useEffect(() => {
    if (paymentMethod === 'paynow') {
      setPaymentMethod(stripeShop ? 'stripe' : 'cod');
    }
    if (paymentMethod === 'stripe' && !stripeShop) {
      setPaymentMethod('cod');
    }
  }, [paymentMethod, stripeShop]);

  const submitLabel = submitting
    ? paymentMethod === 'stripe'
      ? 'Preparing card payment…'
      : paymentMethod === 'ecocash'
        ? 'Starting EcoCash…'
        : paymentMethod === 'wallet'
          ? 'Paying with wallet…'
          : 'Placing order…'
    : paymentMethod === 'stripe' && stripeShop
      ? 'Continue with card'
      : paymentMethod === 'ecocash'
        ? 'Pay with EcoCash'
        : paymentMethod === 'wallet'
          ? 'Pay with wallet'
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
    if (deliveryLoading) {
      setError('Please wait while we calculate delivery from your address.');
      return;
    }
    if (deliveryKm == null) {
      setError(deliveryHint || 'Enter a valid delivery address so we can calculate delivery.');
      return;
    }
    setError('');

    if (!isSupabaseConfigured || !supabase) {
      setError('Orders are saved to Supabase. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY, then run supabase/shop_customer_orders.sql.');
      return;
    }

    if (paymentMethod === 'wallet') {
      if (!session?.id) {
        setError('Sign in to pay with wallet.');
        return;
      }
      if (!canPayWithWallet) {
        setError('Insufficient wallet balance. Top up or pay with cash.');
        return;
      }
    }

    if (paymentMethod === 'ecocash' && !ph) {
      setError('Enter your EcoCash mobile number.');
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
    const appUserId = await resolveValidAppUserId(supabase, session?.id);
    if (paymentMethod === 'wallet' && !appUserId) {
      setSubmitting(false);
      setError('Your login session is out of date. Sign in again to pay with wallet.');
      return;
    }

    const shopPayMethod =
      paymentMethod === 'wallet'
        ? 'wallet'
        : paymentMethod === 'stripe'
          ? 'stripe'
          : paymentMethod === 'ecocash'
            ? 'ecocash'
            : 'cod';

    const { data, error: saveErr } = await saveShopCustomerOrder({
      items,
      customer,
      subtotal,
      deliveryFee,
      paymentMethod: shopPayMethod,
      appUserId,
      paymentStatus: paymentMethod === 'wallet' ? 'pending' : paymentMethod === 'cod' ? 'pending' : 'pending',
    });

    if (saveErr || !data) {
      setSubmitting(false);
      setError(saveErr?.message || 'Could not place order. Try again.');
      return;
    }

    if (paymentMethod === 'wallet') {
      const debit = await debitCustomerWallet({
        userId: appUserId,
        amount: grandTotal,
        label: `Shop order ${data.order_number}`,
        refType: 'shop',
        refId: data.id,
      });
      if (!debit.ok) {
        try {
          await supabase.from('shop_customer_orders').delete().eq('id', data.id);
        } catch {
          // ignore
        }
        setSubmitting(false);
        setError(debit.error || 'Could not pay with wallet.');
        return;
      }
      try {
        await supabase
          .from('shop_customer_orders')
          .update({
            payment_status: 'paid',
            payment_gateway: 'wallet',
            payment_completed_at: new Date().toISOString(),
          })
          .eq('id', data.id);
      } catch {
        // ignore
      }
    }

    const itemCount = items.reduce((s, l) => s + l.qty, 0);
    const confirmStateBase = {
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
      deliveryConfirmationCode: data.delivery_confirmation_code || null,
      payment_method: shopPayMethod,
    };
    if (stripeShop && paymentMethod === 'stripe') {
      const confirmState = { ...confirmStateBase };
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

    if (paymentMethod === 'ecocash') {
      const charge = await postEcocashCharge({
        orderId: data.id,
        orderNumber: data.order_number,
        amount: grandTotal,
        phone: ph,
        orderKind: 'shop',
        customerName: name,
        remarks: `Shop order ${data.order_number}`,
      });
      if (!charge?.ok) {
        try {
          await supabase.from('shop_customer_orders').delete().eq('id', data.id);
        } catch {
          // ignore
        }
        setSubmitting(false);
        setError(charge?.error || 'Could not start EcoCash payment.');
        return;
      }
      setSubmitting(false);
      clearCart();
      writeShopOrderConfirmationState({ ...confirmStateBase, payment_status: 'pending' });
      navigate('/ecocash-waiting', {
        replace: true,
        state: {
          clientCorrelation: charge.clientCorrelation,
          phone: charge.phone || ph,
          orderId: data.id,
          orderKind: 'shop',
          orderNumber: data.order_number,
          notifyTable: 'shop_customer_orders',
          nextPath: '/order-confirmation',
          nextState: { ...confirmStateBase, payment_method: 'ecocash', payment_status: 'paid' },
        },
      });
      return;
    }

    setSubmitting(false);
    clearCart();
    writeShopOrderConfirmationState(confirmStateBase);
    navigate('/order-confirmation', { state: confirmStateBase });
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
              <span>
                Delivery
                {deliveryKm != null && deliveryPerKm != null ? (
                  <span className="cko-fine" style={{ display: 'block', fontSize: '0.78rem', fontWeight: 400, marginTop: '0.15rem' }}>
                    {deliveryKm.toFixed(1)} km × {FMT.format(deliveryPerKm)}/km
                  </span>
                ) : null}
              </span>
              <span>{deliveryLoading ? '…' : FMT.format(deliveryFee)}</span>
            </div>
            {deliveryHint ? (
              <p className="cko-fine" style={{ margin: '0.35rem 0 0' }}>
                {deliveryHint}
              </p>
            ) : null}
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
              <AddressSuggestInput
                id="cko-address"
                name="address"
                className="cko-addr-suggest"
                value={address}
                onChange={(v) => setAddress(v)}
                onSelectSuggestion={(s) => {
                  if (s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))) {
                    setAddressLatLng({ lat: Number(s.lat), lng: Number(s.lng) });
                  } else {
                    setAddressLatLng(null);
                  }
                }}
                autoComplete="street-address"
                placeholder="Start typing your street / area"
                ariaLabel="Delivery address"
                inline
              />
              <p className="cko-fine" style={{ margin: '0.35rem 0 0' }}>
                Pick a suggestion when possible so delivery distance is accurate.
              </p>
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

          <section className="cko-card" aria-label="Payment method">
            <h2 className="cko-card__title">Payment</h2>
            <fieldset className="cko-pay-list">
              <legend className="cko-sr-only">Payment method</legend>
              <label className="cko-pay-opt">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="wallet"
                  checked={paymentMethod === 'wallet'}
                  onChange={() => setPaymentMethod('wallet')}
                />
                <span className="cko-pay-opt__body">
                  <span className="cko-pay-opt__label">Pay with Wallet</span>
                  <span className="cko-pay-opt__sub">
                    {walletLoading ? 'Loading balance…' : `Balance ${formatGBP(walletBalance)}`}
                  </span>
                </span>
              </label>
              <label className="cko-pay-opt">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')}
                />
                <span className="cko-pay-opt__body">
                  <span className="cko-pay-opt__label">Pay with Cash</span>
                  <span className="cko-pay-opt__sub">Pay when your order arrives</span>
                </span>
              </label>
              <label className="cko-pay-opt">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="ecocash"
                  checked={paymentMethod === 'ecocash'}
                  onChange={() => setPaymentMethod('ecocash')}
                />
                <span className="cko-pay-opt__body">
                  <span className="cko-pay-opt__label">Pay with EcoCash</span>
                  <span className="cko-pay-opt__sub">Approve on the phone number above</span>
                </span>
              </label>
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

            {paymentMethod === 'wallet' ? (
              <div className="cko-wallet-box" aria-label="Wallet payment summary">
                <div className="cko-wallet-box__row">
                  <span>Estimated fare</span>
                  <span>{FMT.format(grandTotal)}</span>
                </div>
                <div className="cko-wallet-box__row">
                  <span>Current wallet balance</span>
                  <span>{walletLoading ? '…' : formatGBP(walletBalance)}</span>
                </div>
                <div className="cko-wallet-box__row cko-wallet-box__row--emph">
                  <span>Remaining after order</span>
                  <span className={remainingAfter < 0 ? 'cko-wallet-box__neg' : undefined}>
                    {walletLoading ? '…' : formatGBP(Math.max(0, remainingAfter))}
                  </span>
                </div>
                {!walletLoading && !canPayWithWallet ? (
                  <p className="cko-wallet-box__warn" role="status">
                    Not enough balance. Top up your wallet or choose cash.
                  </p>
                ) : null}
                <Link to="/wallet/top-up" className="cko-wallet-box__link">
                  Top up wallet
                </Link>
              </div>
            ) : null}
          </section>

          {error ? (
            <p className="cko-err" role="alert">
              {error}
            </p>
          ) : null}

          {stripeShop && paymentMethod === 'stripe' ? (
            <p className="cko-fine">You will be redirected to a secure page to pay by card.</p>
          ) : null}
          {paymentMethod === 'ecocash' ? (
            <p className="cko-fine">You will get an EcoCash prompt on the phone number above.</p>
          ) : null}

          <Link to="/shop/cart" className="cko-back-link">
            ← Back to cart
          </Link>
        </div>

        <div className="cko-footer">
          <button
            type="submit"
            className="cko-submit"
            disabled={submitting || deliveryLoading || (paymentMethod === 'wallet' && !canPayWithWallet)}
          >
            {submitting ? submitLabel : `${submitLabel} · ${FMT.format(grandTotal)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
