import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getEcocashStatus } from '../lib/ecocashLocal';
import { notifyDriversOfNewOffer } from '../lib/driverOfferPushNotify';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './requestFlow.css';
import './pePayment.css';

/**
 * After EcoCash charge: wait for phone approval (poll + webhook).
 * location.state: {
 *   clientCorrelation, phone, orderId, orderKind, orderNumber,
 *   amountLabel?, nextPath?, nextState?, notifyTable?
 * }
 */
export default function EcocashWaitingPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const clientCorrelation = String(state?.clientCorrelation || '').trim();
  const phone = String(state?.phone || '').trim();
  const orderId = String(state?.orderId || '').trim();
  const orderKind = String(state?.orderKind || 'delivery').trim();
  const [status, setStatus] = useState('pending');
  const [message, setMessage] = useState('Approve the payment on your EcoCash phone…');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientCorrelation || !phone) {
      setError('Missing EcoCash payment details. Go back and try again.');
      setStatus('failed');
      return undefined;
    }

    let cancelled = false;
    let ticks = 0;

    const finishPaid = async () => {
      if (orderKind === 'customer_wallet' && orderId && isSupabaseConfigured && supabase) {
        try {
          await supabase.rpc('credit_customer_wallet_from_topup', { p_topup_id: orderId });
        } catch {
          // Edge notify / status poll usually credits; this is a client-side safety net.
        }
      }

      const table =
        state?.notifyTable ||
        (orderKind === 'delivery'
          ? 'customer_delivery_orders'
          : orderKind === 'taxi'
            ? 'taxi_bookings'
            : orderKind === 'tuk'
              ? 'tuk_tuk_bookings'
              : orderKind === 'shop'
                ? 'shop_customer_orders'
                : null);
      if (table && orderId) notifyDriversOfNewOffer(table, orderId);

      const nextPath = state?.nextPath || '/order-confirmation';
      const nextState = state?.nextState || { ...state, payment_method: 'ecocash', payment_status: 'paid' };
      navigate(nextPath, { replace: true, state: nextState });
    };

    const poll = async () => {
      ticks += 1;
      try {
        const res = await getEcocashStatus({ clientCorrelation, phone });
        if (cancelled) return;
        if (!res?.ok) {
          setMessage(res?.error || 'Checking payment status…');
          return;
        }
        const ps = String(res.paymentStatus || '').toLowerCase();
        if (ps === 'paid') {
          setStatus('paid');
          setMessage('Payment confirmed.');
          await finishPaid();
          return;
        }
        if (ps === 'failed') {
          setStatus('failed');
          setError('Payment was declined or cancelled on EcoCash.');
          return;
        }
        setStatus('pending');
        setMessage(
          ticks > 20
            ? 'Still waiting for EcoCash approval. Keep your phone unlocked and confirm the prompt.'
            : 'Approve the payment on your EcoCash phone…',
        );
      } catch (e) {
        if (!cancelled) setMessage(e?.message || 'Network error while checking status…');
      }
    };

    void poll();
    const id = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [clientCorrelation, phone, orderId, orderKind, navigate, state]);

  return (
    <div className="flow-screen pe-pay" role="main" aria-label="EcoCash payment">
      <div className="flow-topbar">
        <Link to="/home" className="flow-back" aria-label="Home">
          ←
        </Link>
        <h1 className="flow-topbar__title">EcoCash</h1>
        <span className="flow-topbar__spacer" aria-hidden />
      </div>

      <div className="pe-pay-body" style={{ padding: '1.25rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.05rem', fontWeight: 800, color: '#07408f', margin: '0 0 0.5rem' }}>
          {status === 'paid' ? 'Paid' : status === 'failed' ? 'Not paid' : 'Waiting for approval'}
        </p>
        <p style={{ color: '#64748b', margin: '0 0 1rem', lineHeight: 1.45 }}>{message}</p>
        {error ? (
          <p role="alert" style={{ color: '#b91c1c', fontWeight: 600, margin: '0 0 1rem' }}>
            {error}
          </p>
        ) : null}
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
          Phone: {phone || '—'}
          {clientCorrelation ? (
            <>
              <br />
              Ref: {clientCorrelation}
            </>
          ) : null}
        </p>
        {status === 'failed' ? (
          <button
            type="button"
            className="pe-btn pe-btn--primary"
            style={{ marginTop: '1.25rem' }}
            onClick={() => navigate(-1)}
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
