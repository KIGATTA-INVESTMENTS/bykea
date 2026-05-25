import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_DRIVER_ORDER } from '../data/driverOrderDefaults';
import { formatGBP } from '../lib/currency';
import './driverPortal.css';
import './driverOrdersPremium.css';

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'history', label: 'History' },
];

/** Shapes merged with DEFAULT_DRIVER_ORDER on the active-delivery screen */
const ACTIVE = [
  {
    id: 'ING-00915',
    from: 'Green Valley Mart, Stratford, London E15',
    to: '22 Bloomsbury Way, London WC1A',
    dist: '2.1 km',
    eta: '8 min',
    distDrop: '4.0 km',
    etaDrop: '14 min',
    pkg: 'Shop',
    type: 'Groceries',
    size: 'Medium',
    amount: 4.5,
    customerName: 'Sara Ali',
    customerPhone: '+44 7700 111223',
    specialInstructions: 'Leave at reception if no answer.',
    lineStatus: 'En route to dropoff',
    lineTime: 'Updated 4:12 PM',
  },
  {
    id: 'ING-00918',
    from: 'Royal London Hospital, Whitechapel E1',
    to: 'Kings Cross Station, London N1C',
    dist: '0.8 km',
    eta: '4 min',
    distDrop: '5.2 km',
    etaDrop: '18 min',
    pkg: 'Small',
    type: 'Pharma',
    size: 'Small',
    amount: 2.75,
    customerName: 'Dr. Khan Clinic',
    customerPhone: '+44 7700 998877',
    specialInstructions: '',
    lineStatus: 'Heading to pickup',
    lineTime: 'Assigned 3:55 PM',
  },
];

const HISTORY = [
  { id: 'ING-00790', to: 'Shoreditch', amt: 2.1, st: 'Delivered', t: 'Today · 2:10 PM' },
  { id: 'ING-00765', to: 'Camden', amt: 1.5, st: 'Delivered', t: 'Today · 11:20 AM' },
  { id: 'ING-00720', to: 'Islington', amt: 2.8, st: 'Cancelled', t: 'Yesterday' },
  { id: 'ING-00688', to: 'Hackney', amt: 3.4, st: 'Delivered', t: 'Apr 28' },
  { id: 'ING-00640', to: 'Greenwich', amt: 5.0, st: 'Delivered', t: 'Apr 27' },
];

function statusClass(st) {
  if (st === 'Delivered') return 'dplOrdSt dplOrdSt--dn';
  if (st === 'Cancelled') return 'dplOrdSt dplOrdSt--cx';
  return 'dplOrdSt dplOrdSt--pickup';
}

function lineStatusClass(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('drop')) return 'dplOrdSt dplOrdSt--enroute';
  if (s.includes('pickup')) return 'dplOrdSt dplOrdSt--pickup';
  return 'dplOrdSt dplOrdSt--pickup';
}

export default function DriverOrdersPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('active');

  const openActive = (row) => {
    const { lineStatus, lineTime, ...order } = row;
    navigate('/driver/active-delivery', { state: { order: { ...DEFAULT_DRIVER_ORDER, ...order } } });
  };

  const showEmptyActive = tab === 'active' && ACTIVE.length === 0;

  return (
    <div className="dpl dpl--premium" role="main" aria-label="Orders">
      <header className="dpl__hero">
        <h1 className="dplH dpl__title">Orders</h1>
        <p className="dplIntro dpl__subtitle">Active jobs and your recent delivery history.</p>
      </header>

      <div className="dpl__tabsWrap">
        <div className="dplTabs" role="tablist" aria-label="Order lists">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'dplTab dplTab--on' : 'dplTab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="dplBody">
        {tab === 'active' && (
          <>
            {showEmptyActive ? (
              <p className="dpl__empty">No active deliveries. Go online on Home to receive offers.</p>
            ) : (
              ACTIVE.map((row) => (
                <div key={row.id} className="dplOrdCard dplOrdCard--act">
                  <div className="dplOrdTop">
                    <p className="dplOrdId">{row.id}</p>
                    <span className={lineStatusClass(row.lineStatus)}>{row.lineStatus}</span>
                  </div>

                  <div className="dplRoute">
                    <div className="dplRoute__row dplRoute__row--pick">
                      <span className="dplRoute__dot" aria-hidden />
                      <p className="dplRoute__addr">{row.from}</p>
                    </div>
                    <div className="dplRoute__row dplRoute__row--drop">
                      <span className="dplRoute__dot" aria-hidden />
                      <p className="dplRoute__addr">{row.to}</p>
                    </div>
                  </div>

                  <p className="dplOrdMeta">
                    {row.pkg}
                    {' · '}
                    {row.lineTime}
                  </p>

                  <div className="dplOrdPayout">
                    <span className="dplOrdPayoutLbl">Payout</span>
                    <span className="dplOrdPayoutAmt">{formatGBP(row.amount)}</span>
                  </div>

                  <button type="button" className="dplOrdGo" onClick={() => openActive(row)}>
                    Continue Delivery
                  </button>
                </div>
              ))
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {HISTORY.map((r) => (
              <div key={r.id} className="dplOrdCard dplOrdCard--hist">
                <div className="dplOrdTop">
                  <p className="dplOrdId">{r.id}</p>
                  <span className={statusClass(r.st)}>{r.st}</span>
                </div>
                <p className="dplOrdHistTo">{r.to}</p>
                <div className="dplOrdPayout">
                  <span className="dplOrdPayoutLbl">{r.t}</span>
                  <span className="dplOrdPayoutAmt">{formatGBP(r.amt)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
