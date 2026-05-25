import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  fetchCompletedDeliveriesForDriver,
  isCodDriverCompletedJob,
} from '../lib/driverIncomingBookings';
import { formatGBP } from '../lib/currency';
import { DRIVER_SECURITY_DEPOSIT_MIN_GBP } from '../lib/driverDepositGate';
import { getDriverSession } from '../lib/driverSession';
import { fetchPlatformCommissionSettings } from '../lib/platformCommissionSettings';
import { postLocalPaynowInitiate, resolveShopPaynowLocalInitiateUrl } from '../lib/shopPaynowLocal';
import { writePaynowReturnPath } from '../lib/paynowReturnSession';
import {
  isStripePaymentsConfigured,
  setStripeHostedReturnContext,
  stripeHostedCheckoutRedirect,
} from '../lib/stripeEdge';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import './driverEarningsWalletProfile.css';
import './driverWalletPremium.css';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'earn', label: 'Earnings' },
  { id: 'w', label: 'Withdrawals' },
];

function IcInfo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M12 10.2V16M12 7.2v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IcHistory() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M12 8v5l3 2M21 12a9 9 0 1 1-2.64-6.36"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 4v5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IcWarning() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden className="dw-lowWarnIcon">
      <path
        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IcTxEmpty() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" aria-hidden style={{ margin: '0 auto 0.65rem', display: 'block', color: '#9ca3af' }}>
      <rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function ArEarning() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        d="M12 19V6M8 9l4-3 4 3"
        fill="none"
        stroke="#A85612"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ArWithdraw() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path d="M5 12h14M15 7l4 5-4 5" fill="none" stroke="#1565c0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArCashOut() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M12 3v18M7.5 8.5 12 4l4.5 4.5"
        stroke="#b45309"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="5" y="14" width="14" height="6" rx="1.2" stroke="#b45309" strokeWidth="1.4" />
    </svg>
  );
}

const DEPOSIT_TOPUP_GBP = DRIVER_SECURITY_DEPOSIT_MIN_GBP;

function driverDepositPaynowRef(topupId) {
  const s = String(topupId || '').replace(/-/g, '');
  return `ING-DEP-${s.slice(0, 10).toUpperCase()}`;
}

export default function DriverWalletPage() {
  const location = useLocation();
  const [filter, setFilter] = useState('all');
  const [amount, setAmount] = useState('');
  const [jobs, setJobs] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [commissionPct, setCommissionPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [depositRows, setDepositRows] = useState([]);
  const [depositLive, setDepositLive] = useState(0);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositErr, setDepositErr] = useState('');

  const paynowAvailable = useMemo(() => !!resolveShopPaynowLocalInitiateUrl(), []);
  const stripeAvailable = useMemo(() => isStripePaymentsConfigured(), []);
  /** @type {'paynow' | 'stripe'} */
  const [depositPayMethod, setDepositPayMethod] = useState('paynow');

  const driverId = getDriverSession()?.id || null;

  const refresh = useCallback(async () => {
    if (!driverId || !isSupabaseConfigured || !supabase) {
      setJobs([]);
      setWithdrawals([]);
      setDepositRows([]);
      setDepositLive(0);
      return;
    }
    const doneRows = await fetchCompletedDeliveriesForDriver(supabase, driverId);
    setJobs(doneRows || []);
    const { data } = await supabase
      .from('driver_withdrawal_requests')
      .select('*')
      .eq('driver_id', driverId)
      .order('requested_at', { ascending: false });
    setWithdrawals(data || []);
    const { data: tops, error: topErr } = await supabase
      .from('driver_wallet_topups')
      .select('*')
      .eq('driver_id', driverId)
      .order('created_at', { ascending: false });
    if (!topErr && Array.isArray(tops)) setDepositRows(tops);
    else setDepositRows([]);

    const { data: drvBal, error: balErr } = await supabase
      .from('driver_registrations')
      .select('driver_deposit_balance_gbp')
      .eq('id', driverId)
      .maybeSingle();
    const paidFallback = (tops || [])
      .filter((r) => String(r.payment_status || '').toLowerCase() === 'paid')
      .reduce((s, r) => s + (Number(r.amount_gbp) || 0), 0);
    if (!balErr && drvBal && drvBal.driver_deposit_balance_gbp != null) {
      setDepositLive(Number(drvBal.driver_deposit_balance_gbp) || 0);
    } else {
      setDepositLive(paidFallback);
    }
  }, [driverId]);

  useEffect(() => {
    let cancelled = false;
    if (!driverId || !isSupabaseConfigured || !supabase) return undefined;
    (async () => {
      const { data } = await fetchPlatformCommissionSettings(supabase);
      if (cancelled) return;
      const p = Number(data?.driver_commission_percent);
      setCommissionPct(Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  useEffect(() => {
    if (location.state?.paynowDepositReturn) {
      setMsg('Deposit top-up received. Your balance will update shortly.');
    }
  }, [location.state?.paynowDepositReturn]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => {
    if (paynowAvailable && stripeAvailable) {
      setDepositPayMethod((m) => (m === 'stripe' || m === 'paynow' ? m : 'paynow'));
    } else if (paynowAvailable) setDepositPayMethod('paynow');
    else if (stripeAvailable) setDepositPayMethod('stripe');
  }, [paynowAvailable, stripeAvailable]);

  const gross = useMemo(() => jobs.reduce((s, r) => s + (Number(r.amount) || 0), 0), [jobs]);
  const codCollectedTotal = useMemo(
    () => jobs.filter(isCodDriverCompletedJob).reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [jobs],
  );
  const commission = Math.round(gross * (commissionPct / 100) * 100) / 100;
  const net = Math.round((gross - commission) * 100) / 100;
  const locked = useMemo(
    () =>
      withdrawals
        .filter((w) => {
          const s = String(w.status || '').toLowerCase();
          return s === 'pending' || s === 'approved' || s === 'paid';
        })
        .reduce((s, w) => s + (Number(w.amount) || 0), 0),
    [withdrawals],
  );

  const walletBalance = Math.max(0, Math.round((net - locked - codCollectedTotal) * 100) / 100);
  const deposit = depositLive;
  const minDeposit = DRIVER_SECURITY_DEPOSIT_MIN_GBP;
  const low = deposit < minDeposit;
  const balStr = formatGBP(walletBalance);

  const txList = useMemo(() => {
    const out = [];
    for (const r of jobs) {
      const amt = Number(r.amount) || 0;
      const when = r.at;
      if (isCodDriverCompletedJob(r)) {
        out.push({
          id: `cod-${r.id}`,
          type: 'cod',
          title: `Cash on delivery � ${r.ref}`,
          date: when,
          amount: `-${formatGBP(amt)}`,
        });
      } else {
        out.push({
          id: `e-${r.id}`,
          type: 'earn',
          title: `Completed #${r.ref}`,
          date: when,
          amount: `+${formatGBP(amt)}`,
        });
      }
    }
    for (const w of withdrawals) {
      const st = String(w.status || '').toLowerCase();
      const suffix = st ? ` � ${st}` : '';
      out.push({
        id: `w-${w.id}`,
        type: 'w',
        title: `Withdrawal request${suffix}`,
        date: w.requested_at || w.approved_at || w.paid_at,
        amount: `-${formatGBP(Number(w.amount) || 0)}`,
      });
    }
    for (const d of depositRows) {
      const st = String(d.payment_status || '').toLowerCase();
      const amt = Number(d.amount_gbp) || 0;
      const ref = d.paynow_reference ? String(d.paynow_reference) : 'Deposit';
      out.push({
        id: `dep-${d.id}`,
        type: 'dep',
        title: st === 'paid' ? `Deposit paid � ${ref}` : `Deposit � ${st}`,
        date: d.payment_completed_at || d.payment_started_at || d.created_at,
        amount: st === 'paid' ? `+${formatGBP(amt)}` : `${formatGBP(amt)} � pending`,
      });
    }
    out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    return out;
  }, [jobs, withdrawals, depositRows]);

  const list = txList.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'earn') return t.type === 'earn' || t.type === 'dep';
    if (filter === 'w') return t.type === 'w' || t.type === 'cod';
    return true;
  });

  const submitWithdrawal = async () => {
    setErr('');
    setMsg('');
    if (!driverId || !isSupabaseConfigured || !supabase) {
      setErr('Supabase is not configured.');
      return;
    }
    const n = Number(String(amount).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Enter a valid amount.');
      return;
    }
    if (n > walletBalance) {
      setErr('Amount exceeds available wallet balance.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('driver_withdrawal_requests').insert({
      driver_id: driverId,
      amount: Math.round(n * 100) / 100,
      status: 'pending',
    });
    setBusy(false);
    if (error) {
      setErr(error.message || 'Could not send request.');
      return;
    }
    setAmount('');
    setMsg('Request sent to admin.');
    await refresh();
  };

  const runDepositTopup = async () => {
    setDepositErr('');
    const driver = getDriverSession();
    if (!driverId || !driver || !isSupabaseConfigured || !supabase) {
      setDepositErr('Sign in and connect Supabase to top up.');
      return;
    }
    const usePaynow = depositPayMethod === 'paynow';
    if (usePaynow && !paynowAvailable) {
      setDepositErr(
        'Paynow is not configured. Default API: https://bykea-production.up.railway.app � or set REACT_APP_SHOP_PAYNOW_LOCAL_URL in .env.local. For local Paynow run `cd server && npm start` with Paynow env vars, then restart the app.',
      );
      return;
    }
    if (!usePaynow && !stripeAvailable) {
      setDepositErr(
        'Card top-up needs the app configured for card payments (Supabase and publishable card key).',
      );
      return;
    }

    setDepositBusy(true);
    const { data: row, error: insErr } = await supabase
      .from('driver_wallet_topups')
      .insert({
        driver_id: driverId,
        amount_gbp: DEPOSIT_TOPUP_GBP,
        currency: 'USD',
        payment_status: 'pending',
      })
      .select('id')
      .single();

    if (insErr || !row?.id) {
      setDepositBusy(false);
      setDepositErr(
        insErr?.message?.includes('driver_wallet_topups')
          ? `${insErr.message} � Run supabase/driver_wallet_topups.sql in the SQL editor.`
          : insErr?.message || 'Could not start deposit.',
      );
      return;
    }

    const topupId = row.id;

    if (usePaynow) {
      const orderNumber = driverDepositPaynowRef(topupId);
      const payRes = await postLocalPaynowInitiate({
        orderKind: 'driver_deposit',
        orderNumber,
        orderId: topupId,
        amount: DEPOSIT_TOPUP_GBP,
        customerEmail: driver.email != null ? String(driver.email) : '',
        customerPhone: driver.phone != null ? String(driver.phone) : '',
        customerName: String(driver.full_name || '')
          .trim()
          .slice(0, 120) || 'Driver',
      });

      if (!payRes.ok || !payRes.redirectUrl) {
        await supabase.from('driver_wallet_topups').delete().eq('id', topupId);
        setDepositErr(payRes.error || 'Could not open Paynow.');
        setDepositBusy(false);
        return;
      }

      writePaynowReturnPath('/driver/wallet');
      window.location.href = payRes.redirectUrl;
      return;
    }

    setStripeHostedReturnContext({ flow: 'driver_wallet' });
    const go = await stripeHostedCheckoutRedirect({
      orderKind: 'driver_deposit',
      orderId: topupId,
      cancelPath: '/stripe-cancel',
    });
    if (!go.ok) {
      await supabase.from('driver_wallet_topups').delete().eq('id', topupId);
      setDepositErr(go.error || 'Could not start card checkout.');
    }
    setDepositBusy(false);
  };

  const walletInfoText = (
    <>
      Wallet balance: card / online-paid jobs add here; cash-on-delivery amounts are deducted here. Each completed job
      charges the platform commission percentage against your <strong>security deposit</strong> � when it falls below{' '}
      {formatGBP(minDeposit)} you must top up before accepting new work.
    </>
  );

  return (
    <div className="dvRoot dvRoot--wallet-premium" role="main">
      <header className="dvH">
        <span className="dv__heroSpacer" aria-hidden />
        <h1>My Wallet</h1>
        <span className="dw-historyBtn" aria-hidden>
          <IcHistory />
        </span>
      </header>
      <div className="dvSc">
        <section className="dw-walletHero" aria-label="Wallet balance">
          <p className="dwbL1">Wallet Balance</p>
          <p className="dwbMain">{balStr}</p>
          {codCollectedTotal > 0 ? (
            <p className="dwbCodNote" role="note">
              Cash deliveries: {formatGBP(codCollectedTotal)} taken in cash � deducted from wallet balance.
            </p>
          ) : null}
          <p className="dwbL2">Deposit Balance</p>
          <p className="dwbSubAmt">{formatGBP(deposit)}</p>
          <p className="dwbCommNote">(commission deducted from this)</p>
        </section>

        {low ? (
          <div className="dw-lowWarn" role="alert">
            <IcWarning />
            <div className="dw-lowWarnBody">
              <span className="dw-lowBadge">LOW BALANCE</span>
              <p className="dw-lowText">Your deposit is below the minimum. Top up to keep accepting orders.</p>
              <p className="dw-lowMin">Minimum balance: {formatGBP(minDeposit)}</p>
            </div>
          </div>
        ) : null}

        <div className="dw-infoCard" role="note">
          <span className="dw-infoCardIcon" aria-hidden>
            <IcInfo />
          </span>
          <p className="dw-infoCardText">{walletInfoText}</p>
        </div>

        <section className="dw-topUpCard" aria-label="Top up deposit">
          <h2 className="dw-topUpTitle">Top Up Deposit</h2>
          {depositErr ? (
            <p className="dw-alert dw-alert--error" role="alert">
              {depositErr}
            </p>
          ) : null}
          {paynowAvailable || stripeAvailable ? (
            <>
              {paynowAvailable && stripeAvailable ? (
                <fieldset className="dw-payMethods">
                  <legend>Payment method</legend>
                  <label className={`dw-payRow${depositPayMethod === 'paynow' ? ' dw-payRow--on' : ''}`}>
                    <input
                      type="radio"
                      name="drvDepPay"
                      checked={depositPayMethod === 'paynow'}
                      onChange={() => setDepositPayMethod('paynow')}
                    />
                    <span>Pay now (Paynow � EcoCash, card, or other enabled methods)</span>
                  </label>
                  <label className={`dw-payRow${depositPayMethod === 'stripe' ? ' dw-payRow--on' : ''}`}>
                    <input
                      type="radio"
                      name="drvDepPay"
                      checked={depositPayMethod === 'stripe'}
                      onChange={() => setDepositPayMethod('stripe')}
                    />
                    <span>Card</span>
                  </label>
                </fieldset>
              ) : null}
              <button type="button" className="dw-topUpBtn" disabled={depositBusy} onClick={runDepositTopup}>
                {depositBusy ? 'Starting�' : `Top Up Deposit (${formatGBP(DEPOSIT_TOPUP_GBP)})`}
              </button>
            </>
          ) : (
            <p className="dw-topUpHint">
              Configure Paynow (local server URL) or card payments to top up your deposit.
            </p>
          )}
        </section>

        <section className="dww dw-withdrawCard" aria-label="Withdraw funds">
          <h2 className="dwwT">Withdraw Funds</h2>
          <div className="dw-withdrawTop">
            <button
              type="button"
              className="dw-withdrawAll"
              onClick={() => setAmount(String(walletBalance.toFixed(2)))}
            >
              Withdraw All
            </button>
          </div>
          <div className="dw-withdrawField">
            <span className="dw-withdrawPrefix" aria-hidden>
              �$
            </span>
            <input
              id="wd-amt"
              className="dw-withdrawInput"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoComplete="off"
              aria-label="Withdrawal amount"
            />
          </div>
          <button type="button" className="dw-withdrawBtn" disabled={busy} onClick={submitWithdrawal}>
            {busy ? 'Sending...' : 'Withdraw Funds'}
          </button>
          {msg ? (
            <p className="dw-alert dw-alert--success" role="status">
              {msg}
            </p>
          ) : null}
          {err ? (
            <p className="dw-alert dw-alert--error" role="alert">
              {err}
            </p>
          ) : null}
          <p className="dw-withdrawNote">Requested amount is excluded from available balance immediately.</p>
        </section>

        <h2 className="dvRsec">Transactions</h2>
        <div className="dvPills dw-txPills" role="tablist" aria-label="Transaction type">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              className={filter === f.id ? 'dvPil dvPil--on' : 'dvPil'}
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <div className="dw-txEmpty" role="status">
            <IcTxEmpty />
            <p>No transactions yet.</p>
          </div>
        ) : (
          <div className="dw-txList">
            {list.map((t) => (
              <div className="dvTxR" key={t.id}>
                <div className="dvAr" aria-hidden>
                  {t.type === 'earn' && <ArEarning />}
                  {t.type === 'dep' && <ArEarning />}
                  {t.type === 'w' && <ArWithdraw />}
                  {t.type === 'cod' && <ArCashOut />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="dvTxx">{t.title}</div>
                  <span className="dvTdt">{t.date ? new Date(t.date).toLocaleString() : '�'}</span>
                </div>
                <div
                  className={
                    t.type === 'earn' || t.type === 'dep'
                      ? 'dvTamt dvTamtE'
                      : t.type === 'cod'
                        ? 'dvTamt dvTamtC'
                        : 'dvTamt dvTamtW'
                  }
                >
                  {t.amount}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
