import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCompletedDeliveriesForDriver,
  isCodDriverCompletedJob,
} from '../lib/driverIncomingBookings';
import { formatGBP } from '../lib/currency';
import { getDriverSession } from '../lib/driverSession';
import { fetchPlatformCommissionSettings } from '../lib/platformCommissionSettings';
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

export default function DriverWalletPage() {
  const [filter, setFilter] = useState('all');
  const [amount, setAmount] = useState('');
  const [jobs, setJobs] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [commissionPct, setCommissionPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const driverId = getDriverSession()?.id || null;

  const refresh = useCallback(async () => {
    if (!driverId || !isSupabaseConfigured || !supabase) {
      setJobs([]);
      setWithdrawals([]);
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
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

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
    out.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    return out;
  }, [jobs, withdrawals]);

  const list = txList.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'earn') return t.type === 'earn';
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
  const walletInfoText = 'Wallet balance: online-paid jobs add here; cash-on-delivery amounts are deducted here. Platform commission is taken from your earnings.';

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
        </section>

        <div className="dw-infoCard" role="note">
          <span className="dw-infoCardIcon" aria-hidden>
            <IcInfo />
          </span>
          <p className="dw-infoCardText">{walletInfoText}</p>
        </div>

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
