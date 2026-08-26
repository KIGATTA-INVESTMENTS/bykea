import { useCallback, useEffect, useMemo, useState } from 'react';

import { Link, useLocation, useNavigate } from 'react-router-dom';

import { formatGBP } from '../lib/currency';

import { getCustomerSession } from '../lib/customerSession';

import {

  ensureCustomerWalletTopupCredited,

  fetchCustomerWalletBalance,

  fetchCustomerWalletTransactions,

} from '../lib/customerWallet';

import {

  approxKmFromBalance,

  INGO_BIKE_MIN_FARE,

  INGO_INCLUDED_KM,

  INGO_KM_RATE,

  INGO_SUPPORT_PHONE,

  INGO_TUKTUK_MIN_FARE,

} from '../lib/ingoKilometres';

import './customerAccount.css';



const FILTERS = [

  { id: 'all', label: 'All' },

  { id: 'credit', label: 'Top-ups' },

  { id: 'debit', label: 'Deductions' },

];



function formatTxWhen(iso) {

  try {

    if (!iso) return '';

    return new Date(iso).toLocaleString(undefined, {

      dateStyle: 'medium',

      timeStyle: 'short',

    });

  } catch {

    return '';

  }

}



function RefreshIcon() {

  return (

    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>

      <path

        d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M21 21v-5h-5"

        stroke="currentColor"

        strokeWidth="1.65"

        strokeLinecap="round"

        strokeLinejoin="round"

      />

    </svg>

  );

}



function TxIcon({ type }) {

  if (type === 'debit') {

    return (

      <span className="wl-tx__ic wl-tx__ic--deb" aria-hidden>

        −

      </span>

    );

  }

  return (

    <span className="wl-tx__ic wl-tx__ic--cred" aria-hidden>

      +

    </span>

  );

}



export default function WalletPage() {

  const navigate = useNavigate();

  const location = useLocation();

  const session = getCustomerSession();

  const userId = session?.id || null;



  const [filter, setFilter] = useState('all');

  const [balance, setBalance] = useState(0);

  const [transactions, setTransactions] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  const [flash, setFlash] = useState('');



  const load = useCallback(async () => {

    setLoading(true);

    setError('');

    if (!userId) {

      setBalance(0);

      setTransactions([]);

      setError('Sign in to view your Ingo Kilometres balance.');

      setLoading(false);

      return;

    }

    const [balRes, txRes] = await Promise.all([

      fetchCustomerWalletBalance(userId),

      fetchCustomerWalletTransactions(userId, { limit: 50 }),

    ]);

    setBalance(balRes.balance);

    setTransactions(txRes.transactions);

    setError(balRes.error || txRes.error || '');

    setLoading(false);

  }, [userId]);



  useEffect(() => {

    load();

  }, [load]);



  useEffect(() => {

    const topupId = location.state?.walletTopupId;

    const paidReturn = location.state?.walletTopupPaid || location.state?.paynowWalletReturn;

    if (!paidReturn && !topupId) return;

    let cancelled = false;

    (async () => {

      if (topupId) await ensureCustomerWalletTopupCredited(topupId);

      if (cancelled) return;

      setFlash('Top-up successful. Your Ingo Kilometres balance will update shortly.');

      navigate('/wallet', { replace: true, state: {} });

      load();

    })();

    return () => {

      cancelled = true;

    };

  }, [location.state, navigate, load]);



  useEffect(() => {

    const onVisible = () => {

      if (document.visibilityState === 'visible') load();

    };

    document.addEventListener('visibilitychange', onVisible);

    return () => document.removeEventListener('visibilitychange', onVisible);

  }, [load]);



  const list = useMemo(() => {

    if (filter === 'all') return transactions;

    return transactions.filter((t) => String(t.entry_type) === filter);

  }, [transactions, filter]);



  const recentDeductions = useMemo(

    () => transactions.filter((t) => t.entry_type === 'debit').slice(0, 5),

    [transactions],

  );



  const approxKm = useMemo(() => approxKmFromBalance(balance), [balance]);



  return (

    <div className="cust cust--wallet">

      <header className="oh-nav">

        <h1 className="oh-nav__title">Ingo Kilometres</h1>

        <button

          type="button"

          className="oh-nav__refresh"

          aria-label="Refresh balance"

          title="Refresh"

          onClick={() => load()}

          disabled={loading}

        >

          <RefreshIcon />

        </button>

      </header>



      <div className="wl-main">

        {flash ? (

          <p className="wl-flash" role="status">

            {flash}

          </p>

        ) : null}

        {error ? (

          <p className="wl-err" role="alert">

            {error}

          </p>

        ) : null}



        <section className="wl-balance" aria-label="Ingo Kilometres balance">

          <p className="wl-balance__l">Available balance</p>

          <p className="wl-balance__amt">{loading ? '…' : `${approxKm} km`}</p>

          <div className="wl-balance__ac">

            <button type="button" className="wl-add" onClick={() => navigate('/wallet/top-up')}>

              Top up

            </button>

            <button

              type="button"

              className="wl-wd"

              onClick={() => {

                const el = document.getElementById('wl-history');

                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });

              }}

            >

              History

            </button>

          </div>

        </section>



        <section className="wl-rates" aria-label="Ingo Kilometre rates">

          <h2 className="wl-secT">Rates (wallet trips)</h2>

          <ul className="wl-rates__list">

            <li>

              Bike: {formatGBP(INGO_BIKE_MIN_FARE)} for first {INGO_INCLUDED_KM} km, then{' '}

              {formatGBP(INGO_KM_RATE)}/km

            </li>

            <li>

              Tuktuk: {formatGBP(INGO_TUKTUK_MIN_FARE)} for first {INGO_INCLUDED_KM} km, then{' '}

              {formatGBP(INGO_KM_RATE)}/km

            </li>

          </ul>

        </section>



        <p className="wl-hint">

          Prepaid distance credits for bike and tuktuk trips. Fare is fixed at the Ingo Kilometre rate —

          no cash negotiation. Top up with card, or pay cash/bank at our office.

        </p>



        <details className="wl-tos">

          <summary>Terms of service</summary>

          <ul>

            <li>

              Bike trips of {INGO_INCLUDED_KM} km or less are charged {formatGBP(INGO_BIKE_MIN_FARE)}.

            </li>

            <li>

              Tuktuk trips of {INGO_INCLUDED_KM} km or less are charged {formatGBP(INGO_TUKTUK_MIN_FARE)}.

            </li>

            <li>

              Every kilometre beyond the first {INGO_INCLUDED_KM} km is charged at {formatGBP(INGO_KM_RATE)}.

            </li>

            <li>Balance is deducted automatically when you book with wallet credit.</li>

            <li>While paying with wallet credit, the fare is fixed and not open to negotiation.</li>

            <li>Kilometre credits do not expire and roll over month to month.</li>

            <li>

              If a trip&apos;s fare exceeds your balance, top up or book with cash on delivery instead.

            </li>

            <li>

              Top-ups via card, or bank transfer/cash at Ingo offices / Support (

              {INGO_SUPPORT_PHONE}).

            </li>

            <li>Credit purchases are non-refundable, except at Ingo&apos;s discretion.</li>

          </ul>

        </details>



        {recentDeductions.length > 0 ? (

          <>

            <h2 className="wl-secT">Recent deductions</h2>

            <div className="wl-crd wl-crd--tx">

              {recentDeductions.map((tx) => (

                <div key={tx.id} className="wl-tx">

                  <TxIcon type="debit" />

                  <div className="wl-tx__body">

                    <div className="wl-tx__title">{tx.label || 'Deduction'}</div>

                    <div className="wl-tx__meta">{formatTxWhen(tx.created_at)}</div>

                  </div>

                  <span className="wl-txR wl-deb">−{formatGBP(tx.amount_gbp)}</span>

                </div>

              ))}

            </div>

          </>

        ) : null}



        <h2 className="wl-secT" id="wl-history">

          Transaction history

        </h2>

        <div className="oh-filters" role="tablist" aria-label="Filter transactions">

          {FILTERS.map((f) => (

            <button

              key={f.id}

              type="button"

              role="tab"

              aria-selected={filter === f.id}

              className={filter === f.id ? 'oh-pill oh-pill--on' : 'oh-pill'}

              onClick={() => setFilter(f.id)}

            >

              {f.label}

            </button>

          ))}

        </div>



        <div className="wl-crd wl-crd--tx">

          {loading ? (

            <p className="wl-empty">Loading…</p>

          ) : list.length === 0 ? (

            <p className="wl-empty">

              No transactions yet.{' '}

              <Link to="/wallet/top-up" className="wl-empty__link">

                Top up Ingo Kilometres

              </Link>{' '}

              to get started.

            </p>

          ) : (

            list.map((tx) => {

              const isCredit = tx.entry_type === 'credit';

              return (

                <div key={tx.id} className="wl-tx">

                  <TxIcon type={isCredit ? 'credit' : 'debit'} />

                  <div className="wl-tx__body">

                    <div className="wl-tx__title">{tx.label || (isCredit ? 'Top-up' : 'Deduction')}</div>

                    <div className="wl-tx__meta">

                      {formatTxWhen(tx.created_at)}

                      {tx.km_credits != null && Number(tx.km_credits) > 0

                        ? ` · ${Number(tx.km_credits)} km`

                        : ''}

                    </div>

                  </div>

                  <span className={isCredit ? 'wl-txR wl-cred' : 'wl-txR wl-deb'}>

                    {isCredit ? '+' : '−'}

                    {formatGBP(tx.amount_gbp)}

                  </span>

                </div>

              );

            })

          )}

        </div>

      </div>

    </div>

  );

}


