import { useState } from 'react';
import './adminPortal.css';

const baseFares = [
  { service: 'Bike Delivery', base: 'Â$1.00', min: 'Â$0.80' },
  { service: 'Car Delivery', base: 'Â$2.00', min: 'Â$1.50' },
  { service: 'Tuk-Tuk Ride', base: 'Â$0.80', min: 'Â$0.60' },
  { service: 'Standard Taxi', base: 'Â$2.50', min: 'Â$2.00' },
  { service: 'Premium Taxi', base: 'Â$4.00', min: 'Â$3.00' },
];

const initialPromos = [
  { code: 'INGO20', discount: '20% off', expiry: '30 Apr 2026', usage: '450 used', active: true },
  { code: 'FREERIDE', discount: 'Â$2 fixed', expiry: '15 May 2026', usage: '220 used', active: true },
  { code: 'SHOP5', discount: '5% off shop orders', expiry: '10 May 2026', usage: '180 used', active: false },
];

export default function AdminPricingConfigurationPage() {
  const [surgeEnabled, setSurgeEnabled] = useState(true);
  const [trafficMultiplier, setTrafficMultiplier] = useState(true);
  const [weekendPricing, setWeekendPricing] = useState(true);
  const [deductFromDeposit, setDeductFromDeposit] = useState(true);
  const [promos, setPromos] = useState(initialPromos);
  const [showConfirm, setShowConfirm] = useState(false);

  const removePromo = (code) => setPromos((current) => current.filter((promo) => promo.code !== code));

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Pricing Configuration</h2>
        <div className="admFilters" style={{ alignItems: 'center' }}>
          <small className="admDim">Last updated: 25 Apr 2026, 09:48 AM</small>
          <button className="admBtn admBtnAuto" type="button" onClick={() => setShowConfirm(true)}>
            Save Changes
          </button>
        </div>
      </div>

      <section className="admWarnCard">
        <span style={{ color: '#ec9120', fontSize: '1.1rem' }} aria-hidden>âš </span>
        <div>
          <strong>Changes to pricing will affect all new orders immediately</strong>
          <div style={{ color: '#cf7a16', marginTop: '0.2rem' }}>Proceed with caution</div>
        </div>
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader"><h3>Base Fare</h3></div>
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Service</th>
                <th>Base Fare</th>
                <th>Min Fare</th>
                <th>Edit</th>
              </tr>
            </thead>
            <tbody>
              {baseFares.map((fare) => (
                <tr key={fare.service}>
                  <td>{fare.service}</td>
                  <td>{fare.base}</td>
                  <td>{fare.min}</td>
                  <td><button className="admLink" type="button">âœŽ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admGrid2" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard">
          <div className="admSectionHeader"><h3>Per Kilometer Rate</h3></div>
          <div className="admField"><label htmlFor="rate-first">First 2km rate</label><input id="rate-first" className="admInput" defaultValue="Â$0.30/km" /></div>
          <div className="admField"><label htmlFor="rate-extra">Additional km rate</label><input id="rate-extra" className="admInput" defaultValue="Â$0.20/km" /></div>
          <div className="admField"><label htmlFor="rate-max">Maximum distance cap</label><input id="rate-max" className="admInput" defaultValue="50km" /></div>
          <label className="admToggleRow" htmlFor="traffic-multi">
            <span>Apply traffic multiplier</span>
            <input id="traffic-multi" type="checkbox" checked={trafficMultiplier} onChange={(event) => setTrafficMultiplier(event.target.checked)} />
          </label>
        </article>

        <article className="admCard">
          <div className="admSectionHeader"><h3>Traffic Based Pricing</h3></div>
          <p className="admDim">Apply surge pricing during peak hours and heavy traffic</p>
          <label className="admToggleRow" htmlFor="surge-enabled">
            <span>Enable surge pricing</span>
            <input id="surge-enabled" type="checkbox" checked={surgeEnabled} onChange={(event) => setSurgeEnabled(event.target.checked)} />
          </label>
          <div className="admTableWrap" style={{ marginTop: '0.5rem' }}>
            <table className="admTable">
              <thead>
                <tr>
                  <th>Traffic Level</th>
                  <th>Multiplier</th>
                  <th>Color</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Low Traffic</td><td><input className="admInlineInput" defaultValue="1.0x" /></td><td><span className="admDotGreen" /></td></tr>
                <tr><td>Moderate</td><td><input className="admInlineInput" defaultValue="1.2x" /></td><td><span className="admDotYellow" /></td></tr>
                <tr><td>Heavy</td><td><input className="admInlineInput" defaultValue="1.5x" /></td><td><span className="admDotOrange" /></td></tr>
                <tr><td>Severe</td><td><input className="admInlineInput" defaultValue="2.0x" /></td><td><span className="admDotRed" /></td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="admGrid2" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard">
          <div className="admSectionHeader"><h3>Peak Hours Pricing</h3></div>
          <div className="admPeakRow"><strong>Morning</strong><span>7am - 9am</span><input className="admInlineInput" defaultValue="1.3x" /></div>
          <div className="admPeakRow"><strong>Evening</strong><span>5pm - 8pm</span><input className="admInlineInput" defaultValue="1.4x" /></div>
          <div className="admPeakRow"><strong>Late Night</strong><span>11pm - 5am</span><input className="admInlineInput" defaultValue="1.5x" /></div>
          <button className="admLink" type="button">Add Peak Period</button>
          <label className="admToggleRow" htmlFor="weekend-pricing" style={{ marginTop: '0.5rem' }}>
            <span>Apply weekend pricing</span>
            <input id="weekend-pricing" type="checkbox" checked={weekendPricing} onChange={(event) => setWeekendPricing(event.target.checked)} />
          </label>
          <div className="admField" style={{ marginBottom: 0 }}>
            <label htmlFor="weekend-multiplier">Weekend multiplier</label>
            <input id="weekend-multiplier" className="admInput" defaultValue="1.2x" />
          </div>
        </article>

        <article className="admCard">
          <div className="admSectionHeader"><h3>Commission Settings</h3></div>
          <div className="admField"><label htmlFor="driver-commission">Driver commission</label><input id="driver-commission" className="admInput" defaultValue="15%" /></div>
          <div className="admField"><label htmlFor="shop-commission">Shop owner commission</label><input id="shop-commission" className="admInput" defaultValue="10%" /></div>
          <div className="admField"><label htmlFor="min-commission">Minimum commission per order</label><input id="min-commission" className="admInput" defaultValue="Â$0.50" /></div>
          <label className="admToggleRow" htmlFor="deduct-deposit">
            <span>Deduct from deposit</span>
            <input id="deduct-deposit" type="checkbox" checked={deductFromDeposit} onChange={(event) => setDeductFromDeposit(event.target.checked)} />
          </label>
        </article>
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admSectionHeader">
          <h3>Active Promotions</h3>
          <button className="admOutlineBtn" type="button">Add Promotion</button>
        </div>
        {promos.map((promo) => (
          <div key={promo.code} className="admPromoRow">
            <div>
              <strong style={{ color: '#0A58A6' }}>{promo.code}</strong>
              <div className="admDim">{promo.discount}</div>
            </div>
            <div className="admDim">{promo.expiry}</div>
            <div className="admDim">{promo.usage}</div>
            <label className="admSwitchCompact" htmlFor={`promo-${promo.code}`}>
              <input
                id={`promo-${promo.code}`}
                type="checkbox"
                checked={promo.active}
                onChange={() => {
                  setPromos((current) =>
                    current.map((item) => (item.code === promo.code ? { ...item, active: !item.active } : item)),
                  );
                }}
              />
            </label>
            <button className="admDangerInline" type="button" onClick={() => removePromo(promo.code)} aria-label="Delete promo">ðŸ—‘</button>
          </div>
        ))}
      </section>

      <section>
        <button className="admBtn" type="button" onClick={() => setShowConfirm(true)}>Save All Changes</button>
      </section>

      {showConfirm && (
        <div className="admModalOverlay" role="presentation" onClick={() => setShowConfirm(false)}>
          <div className="admModal" role="dialog" aria-modal="true" aria-label="Confirm pricing update" onClick={(event) => event.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Confirm Pricing Update</h3>
            <p className="admDim">You are about to apply new base fare, surge, peak hour and commission settings.</p>
            <ul className="admModalList">
              <li>Traffic multiplier and surge pricing</li>
              <li>Peak hour and weekend multipliers</li>
              <li>Commission and active promotions</li>
            </ul>
            <div className="admModalActions">
              <button className="admOutlineGrayBtn" type="button" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="admBtn admBtnAuto" type="button" onClick={() => setShowConfirm(false)}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
