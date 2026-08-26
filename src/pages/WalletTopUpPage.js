import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatGBP } from '../lib/currency';
import { getCustomerSession } from '../lib/customerSession';
import {
  createCustomerWalletTopup,
  WALLET_TOPUP_MAX,
  WALLET_TOPUP_MIN,
  WALLET_TOPUP_PACKAGES,
} from '../lib/customerWallet';
import { postEcocashCharge } from '../lib/ecocashLocal';
import { INGO_SUPPORT_PHONE, INGO_KM_RATE } from '../lib/ingoKilometres';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './customerAccount.css';

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function WalletTopUpPage() {
  const navigate = useNavigate();
  const session = getCustomerSession();
  const userId = session?.id || null;

  const showStripe = useMemo(() => isStripePaymentsConfigured(), []);
  const [payMethod, setPayMethod] = useState(() => (isStripePaymentsConfigured() ? 'stripe' : 'ecocash'));
  const [ecoPhone, setEcoPhone] = useState(() => String(session?.phone || '').trim());

  const [selectedPackageId, setSelectedPackageId] = useState(WALLET_TOPUP_PACKAGES[0]?.id || 'custom');
  const [customAmount, setCustomAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isCustom = selectedPackageId === 'custom';
  const selectedPkg = WALLET_TOPUP_PACKAGES.find((p) => p.id === selectedPackageId) || null;

  const amount = useMemo(() => {
    if (isCustom) {
      const n = Number(String(customAmount).replace(/,/g, '').trim());
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
    }
    return selectedPkg ? selectedPkg.amount : NaN;
  }, [isCustom, customAmount, selectedPkg]);

  const packageLabel = isCustom
    ? 'Custom Ingo Kilometres top-up'
    : selectedPkg
      ? selectedPkg.label
      : 'Ingo Kilometres top-up';
  const kmCredits = isCustom ? null : selectedPkg?.km ?? null;
  const canPayOnline = true;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!userId) {
      setError('Sign in to top up Ingo Kilometres.');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured.');
      return;
    }
    if (!Number.isFinite(amount) || amount < WALLET_TOPUP_MIN || amount > WALLET_TOPUP_MAX) {
      setError(`Enter an amount between ${formatGBP(WALLET_TOPUP_MIN)} and ${formatGBP(WALLET_TOPUP_MAX)}.`);
      return;
    }

    const method = payMethod === 'stripe' && showStripe ? 'stripe' : 'ecocash';
    if (method === 'stripe' && !showStripe) {
      setError('Card payments need Stripe configured.');
      return;
    }
    if (method === 'ecocash' && !String(ecoPhone || '').trim()) {
      setError('Enter the EcoCash mobile number that will approve payment.');
      return;
    }

    setSubmitting(true);
    const { data: topup, error: createErr } = await createCustomerWalletTopup({
      userId,
      amount,
      packageId: isCustom ? 'custom' : selectedPkg?.id || null,
      packageLabel,
      kmCredits,
    });

    if (createErr || !topup) {
      setSubmitting(false);
      setError(createErr?.message || 'Could not start top-up.');
      return;
    }

    if (method === 'ecocash') {
      const orderNumber = String(topup.paynow_reference || `ING-CW-${String(topup.id).replace(/-/g, '').slice(0, 10)}`).toUpperCase();
      const charge = await postEcocashCharge({
        orderId: topup.id,
        orderNumber,
        amount,
        phone: ecoPhone,
        orderKind: 'customer_wallet',
        customerName: session?.full_name || session?.email || 'Customer',
        remarks: `Wallet top-up ${orderNumber}`,
      });
      if (!charge?.ok) {
        try {
          await supabase.from('customer_wallet_topups').delete().eq('id', topup.id);
        } catch {
          // ignore
        }
        setSubmitting(false);
        setError(charge?.error || 'Could not start EcoCash payment.');
        return;
      }
      setSubmitting(false);
      navigate('/ecocash-waiting', {
        replace: true,
        state: {
          clientCorrelation: charge.clientCorrelation,
          phone: charge.phone || ecoPhone,
          orderId: topup.id,
          orderKind: 'customer_wallet',
          orderNumber,
          nextPath: '/wallet',
          nextState: { walletTopupPaid: true, walletTopupId: topup.id },
        },
      });
      return;
    }

    setStripeHostedReturnContext({
      flow: 'customer_wallet',
      topupId: topup.id,
    });

    const go = await stripeHostedCheckoutRedirect({
      orderKind: 'customer_wallet',
      orderId: topup.id,
      cancelPath: '/wallet/top-up',
    });

    if (!go.ok) {
      try {
        await supabase.from('customer_wallet_topups').delete().eq('id', topup.id);
      } catch {
        // ignore
      }
      setError(go.error || 'Could not start card checkout.');
      setSubmitting(false);
    }
  };

  return (
    <div className="cust cust--wallet-topup">
      <header className="oh-nav wl-topup-nav">
        <button type="button" className="oh-nav__back" onClick={() => navigate('/wallet')} aria-label="Back to Ingo Kilometres">
          <BackArrow />
        </button>
        <h1 className="oh-nav__title">Top up</h1>
        <span aria-hidden className="oh-nav__spacer" />
      </header>

      <form className="wl-topup" onSubmit={onSubmit}>
        <p className="wl-topup__lead">
          Buy prepaid Ingo Kilometres ({formatGBP(INGO_KM_RATE)}/km). Choose a pack or a custom amount. Pay by
          card, EcoCash, or cash/bank at our office.
        </p>

        <h2 className="wl-secT">Packages</h2>
        <div className="wl-packs" role="listbox" aria-label="Top-up packages">
          {WALLET_TOPUP_PACKAGES.map((pkg) => {
            const on = selectedPackageId === pkg.id;
            return (
              <button
                key={pkg.id}
                type="button"
                role="option"
                aria-selected={on}
                className={on ? 'wl-pack wl-pack--on' : 'wl-pack'}
                onClick={() => setSelectedPackageId(pkg.id)}
              >
                <span className="wl-pack__km">{pkg.km} km</span>
                <span className="wl-pack__amt">{formatGBP(pkg.amount)}</span>
              </button>
            );
          })}
          <button
            type="button"
            role="option"
            aria-selected={isCustom}
            className={isCustom ? 'wl-pack wl-pack--on' : 'wl-pack'}
            onClick={() => setSelectedPackageId('custom')}
          >
            <span className="wl-pack__km">Custom</span>
            <span className="wl-pack__amt">Any amount</span>
          </button>
        </div>

        {isCustom ? (
          <label className="wl-field">
            <span className="wl-field__l">Amount (USD)</span>
            <input
              className="wl-field__in"
              type="number"
              inputMode="decimal"
              min={WALLET_TOPUP_MIN}
              max={WALLET_TOPUP_MAX}
              step="0.01"
              placeholder={`e.g. ${WALLET_TOPUP_MIN}`}
              value={customAmount}
              onChange={(ev) => setCustomAmount(ev.target.value)}
              required
            />
          </label>
        ) : null}

        <section className="wl-crd wl-pay" aria-label="Payment method">
          <h2 className="wl-secT" style={{ marginTop: 0 }}>
            Pay with
          </h2>
          <fieldset className="wl-pay-list">
            <legend className="cko-sr-only">Payment method</legend>
            {showStripe ? (
              <label className="wl-pay-opt">
                <input
                  type="radio"
                  name="walletPay"
                  value="stripe"
                  checked={payMethod === 'stripe'}
                  onChange={() => setPayMethod('stripe')}
                />
                <span>
                  <span className="wl-pay-opt__label">Card</span>
                  <span className="wl-pay-opt__sub">Secure checkout on Stripe</span>
                </span>
              </label>
            ) : null}
            <label className="wl-pay-opt">
              <input
                type="radio"
                name="walletPay"
                value="ecocash"
                checked={payMethod === 'ecocash'}
                onChange={() => setPayMethod('ecocash')}
              />
              <span>
                <span className="wl-pay-opt__label">EcoCash</span>
                <span className="wl-pay-opt__sub">Approve on your phone</span>
              </span>
            </label>
          </fieldset>

          {payMethod === 'ecocash' ? (
            <label className="wl-field" style={{ marginTop: '0.85rem' }}>
              <span className="wl-field__l">EcoCash number</span>
              <input
                className="wl-field__in"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0771234567"
                value={ecoPhone}
                onChange={(ev) => setEcoPhone(ev.target.value)}
                required
              />
            </label>
          ) : null}

          <p className="wl-pay-cash-note">
            Bank transfer or cash: pay at Ingo offices or through Support ({INGO_SUPPORT_PHONE}). An admin will
            credit your balance once payment is confirmed.
          </p>
        </section>

        {error ? (
          <p className="wl-err" role="alert">
            {error}
          </p>
        ) : null}

        <div className="wl-topup__foot">
          <button type="submit" className="wl-topup__btn" disabled={submitting || !canPayOnline}>
            {submitting
              ? 'Starting payment…'
              : Number.isFinite(amount)
                ? payMethod === 'ecocash'
                  ? `Pay ${formatGBP(amount)} with EcoCash`
                  : `Pay ${formatGBP(amount)} with Card`
                : 'Continue to pay'}
          </button>
          <Link to="/wallet" className="wl-topup__cancel">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
