import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import InGoLogo from '../components/InGoLogo';
import './adminPortal.css';

const zones = [
  { id: 1, name: 'Central London', city: 'London', radius: '10km', active: true },
  { id: 2, name: 'Greater Manchester', city: 'Manchester', radius: '8km', active: true },
  { id: 3, name: 'West Midlands', city: 'Birmingham', radius: '6km', active: false },
];

export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const [maintenance, setMaintenance] = useState(false);
  const [whitelist, setWhitelist] = useState(true);
  const [ips, setIps] = useState(['81.134.202.29', '81.134.202.30']);
  const [newIp, setNewIp] = useState('');

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <button className="admBtn admBtnAuto" type="button">Save Changes</button>
      </div>

      <section className="admCard admSettingsCard">
        <h3>General</h3>
        <div className="admSettingsGrid">
          <div className="admField"><label htmlFor="platform-name">Platform Name</label><input id="platform-name" className="admInput" defaultValue="InGo" /></div>
          <div className="admField"><label htmlFor="language">Default Language</label><select id="language" className="admSelect"><option>English</option><option>French</option><option>Portuguese</option></select></div>
          <div className="admField"><label htmlFor="currency">Default Currency</label><select id="currency" className="admSelect" defaultValue="USD"><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></div>
          <div className="admField"><label htmlFor="country">Default Country</label><select id="country" className="admSelect"><option>United Kingdom</option><option>Ireland</option><option>France</option></select></div>
          <div className="admField"><label htmlFor="timezone">Timezone</label><select id="timezone" className="admSelect"><option>Europe/London</option><option>Europe/Dublin</option></select></div>
          <div className="admField"><label htmlFor="date-format">Date Format</label><select id="date-format" className="admSelect"><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></div>
        </div>
        <div className="admSettingsUploads">
          <div>
            <label>Platform Logo</label>
            <div className="admLogoPreview">
              <InGoLogo variant="admin" />
            </div>
            <button className="admOutlineBtn" type="button">Change Logo</button>
          </div>
          <div>
            <label>Platform Favicon</label>
            <div className="admLogoPreview admSmall">
              <InGoLogo variant="adminSidebar" />
            </div>
            <button className="admOutlineBtn" type="button">Change Favicon</button>
          </div>
        </div>
        <button className="admBtnSmall" type="button">Save General</button>
      </section>

      <section className="admCard admSettingsCard">
        <h3>Notifications</h3>
        <div className="admSettingsGrid">
          {['Push Notifications', 'SMS Notifications', 'Email Notifications', 'WhatsApp Notifications'].map((item) => (
            <label key={item} className="admToggleRow" htmlFor={item}><span>{item}</span><input id={item} type="checkbox" defaultChecked /></label>
          ))}
        </div>
        <div className="admSettingsGrid">
          <div className="admCard admInsetCard">
            <h4>SMS Provider</h4>
            <div className="admField"><label htmlFor="sms-provider">Provider</label><select id="sms-provider" className="admSelect"><option>Twilio</option><option>AfricasTalking</option></select></div>
            <div className="admField"><label htmlFor="sms-api">API Key</label><input id="sms-api" className="admInput" type="password" defaultValue="******" /></div>
            <div className="admField"><label htmlFor="sender-id">Sender ID</label><input id="sender-id" className="admInput" defaultValue="InGo" /></div>
            <button className="admOutlineBtn" type="button">Test SMS</button>
          </div>
          <div className="admCard admInsetCard">
            <h4>Email Provider</h4>
            <div className="admField"><label htmlFor="smtp-host">SMTP Host</label><input id="smtp-host" className="admInput" defaultValue="smtp.ingo.com" /></div>
            <div className="admField"><label htmlFor="smtp-port">SMTP Port</label><input id="smtp-port" className="admInput" defaultValue="587" /></div>
            <div className="admField"><label htmlFor="email-from">Email From</label><input id="email-from" className="admInput" defaultValue="support@ingo.com" /></div>
            <div className="admField"><label htmlFor="smtp-password">Password</label><input id="smtp-password" className="admInput" type="password" defaultValue="******" /></div>
            <button className="admOutlineBtn" type="button">Test Email</button>
          </div>
          <div className="admCard admInsetCard">
            <h4>WhatsApp</h4>
            <div className="admField"><label htmlFor="wa-api">API Key</label><input id="wa-api" className="admInput" type="password" defaultValue="******" /></div>
            <div className="admField"><label htmlFor="wa-id">Phone Number ID</label><input id="wa-id" className="admInput" defaultValue="22110044" /></div>
            <button className="admOutlineBtn" type="button">Test WhatsApp</button>
          </div>
        </div>
      </section>

      <section className="admCard admSettingsCard">
        <h3>Maps &amp; GPS</h3>
        <div className="admSettingsGrid">
          <div className="admField"><label htmlFor="map-provider">Map Provider</label><select id="map-provider" className="admSelect"><option>Google Maps</option><option>OpenStreetMap</option></select></div>
          <div className="admField"><label htmlFor="map-key">Google Maps API Key</label><input id="map-key" className="admInput" type="password" defaultValue="******" /></div>
          <div className="admField"><label htmlFor="lat">Latitude</label><input id="lat" className="admInput" defaultValue="-17.8252" /></div>
          <div className="admField"><label htmlFor="lng">Longitude</label><input id="lng" className="admInput" defaultValue="31.0335" /></div>
          <div className="admField"><label htmlFor="zoom">Default Zoom Level</label><input id="zoom" type="range" min="8" max="18" defaultValue="12" /></div>
          <label className="admToggleRow" htmlFor="geofencing"><span>Enable Geofencing</span><input id="geofencing" type="checkbox" defaultChecked /></label>
        </div>
        {zones.map((zone) => (
          <div key={zone.id} className="admZoneRow">
            <div><strong>{zone.name}</strong><p className="admDim">{zone.city} - {zone.radius}</p></div>
            <label className="admSwitchCompact" htmlFor={`zone-${zone.id}`}><input id={`zone-${zone.id}`} type="checkbox" defaultChecked={zone.active} /></label>
            <div className="admActions"><button type="button">?</button><button type="button" style={{ color: '#d34444' }}>??</button></div>
          </div>
        ))}
        <button className="admLink" type="button">Add Zone</button>
      </section>

      <section className="admCard admSettingsCard">
        <h3>Payment Gateways</h3>
        <div className="admSettingsGrid">
          <div className="admCard admInsetCard">
            <h4>UK bank transfer</h4>
            <label className="admToggleRow" htmlFor="ecocash"><span>Enabled</span><input id="ecocash" type="checkbox" defaultChecked /></label>
            <div className="admField"><label htmlFor="merchant-id">Merchant ID</label><input id="merchant-id" className="admInput" defaultValue="ECO-0012" /></div>
            <div className="admField"><label htmlFor="eco-key">API Key</label><input id="eco-key" className="admInput" type="password" defaultValue="******" /></div>
            <div className="admRadioRow"><label htmlFor="live"><input id="live" type="radio" name="env" defaultChecked /> Live</label><label htmlFor="sandbox"><input id="sandbox" type="radio" name="env" /> Sandbox</label></div>
            <button className="admBtnSmall" type="button">Test Connection</button>
          </div>
          <div className="admCard admInsetCard">
            <h4>Card Payment</h4>
            <label className="admToggleRow" htmlFor="card-enabled"><span>Enabled</span><input id="card-enabled" type="checkbox" defaultChecked /></label>
            <div className="admField"><label htmlFor="card-provider">Provider</label><select id="card-provider" className="admSelect"><option>Stripe</option><option>Card</option></select></div>
            <div className="admField"><label htmlFor="card-public">Public Key</label><input id="card-public" className="admInput" defaultValue="pk_test_ingo" /></div>
            <div className="admField"><label htmlFor="card-secret">Secret Key</label><input id="card-secret" className="admInput" type="password" defaultValue="******" /></div>
            <button className="admBtnSmall" type="button">Test Connection</button>
          </div>
          <div className="admCard admInsetCard">
            <h4>Cash on Delivery</h4>
            <label className="admToggleRow" htmlFor="cod-enabled"><span>Enabled</span><input id="cod-enabled" type="checkbox" defaultChecked /></label>
            <h4 style={{ marginTop: '0.8rem' }}>InGo Wallet</h4>
            <label className="admToggleRow" htmlFor="wallet-enabled"><span>Enabled</span><input id="wallet-enabled" type="checkbox" defaultChecked /></label>
            <div className="admField"><label htmlFor="min-topup">Minimum top up amount</label><input id="min-topup" className="admInput" defaultValue="�$2.00" /></div>
            <div className="admField"><label htmlFor="max-wallet">Maximum wallet balance</label><input id="max-wallet" className="admInput" defaultValue="�$500.00" /></div>
          </div>
        </div>
      </section>

      <section className="admCard admSettingsCard">
        <h3>Security</h3>
        <div className="admSettingsGrid">
          <label className="admToggleRow" htmlFor="2fa"><span>Two Factor Authentication</span><input id="2fa" type="checkbox" defaultChecked /></label>
          <div className="admField"><label htmlFor="session-timeout">Session timeout</label><input id="session-timeout" className="admInput" defaultValue="30 minutes" /></div>
          <div className="admField"><label htmlFor="max-attempts">Max login attempts</label><input id="max-attempts" className="admInput" defaultValue="5" /></div>
          <div className="admField"><label htmlFor="min-length">Min password length</label><input id="min-length" className="admInput" defaultValue="8" /></div>
          <label className="admToggleRow" htmlFor="req-up"><span>Require uppercase</span><input id="req-up" type="checkbox" defaultChecked /></label>
          <label className="admToggleRow" htmlFor="req-num"><span>Require numbers</span><input id="req-num" type="checkbox" defaultChecked /></label>
          <label className="admToggleRow" htmlFor="req-special"><span>Require special chars</span><input id="req-special" type="checkbox" defaultChecked /></label>
        </div>
        <label className="admToggleRow" htmlFor="ip-whitelist"><span>Enable IP whitelist</span><input id="ip-whitelist" type="checkbox" checked={whitelist} onChange={(event) => setWhitelist(event.target.checked)} /></label>
        {whitelist && (
          <>
            <div className="admFilters" style={{ marginBottom: '0.5rem' }}>
              <input className="admInput" value={newIp} onChange={(event) => setNewIp(event.target.value)} placeholder="Enter IP" />
              <button
                className="admBtnSmall"
                type="button"
                onClick={() => {
                  if (!newIp.trim()) return;
                  setIps((current) => [...current, newIp.trim()]);
                  setNewIp('');
                }}
              >
                Add IP
              </button>
            </div>
            <div className="admIpRowWrap">
              {ips.map((ip) => (
                <span className="admIpChip" key={ip}>
                  {ip}
                  <button type="button" onClick={() => setIps((current) => current.filter((item) => item !== ip))}>?</button>
                </span>
              ))}
            </div>
          </>
        )}
        <div className="admFilters">
          <button className="admDangerBtn" type="button">Clear All Sessions</button>
          <button className="admLink" type="button">Security Audit Log</button>
        </div>
      </section>

      <section className="admCard admSettingsCard">
        <h3>Mobile App</h3>
        <div className="admSettingsGrid">
          <div className="admField"><label>Customer App Version</label><p className="admDim">v2.4.1</p></div>
          <div className="admField"><label>Driver App Version</label><p className="admDim">v2.4.1</p></div>
          <label className="admToggleRow" htmlFor="force-update"><span>Force users to update</span><input id="force-update" type="checkbox" defaultChecked /></label>
          <label className="admToggleRow" htmlFor="maintenance"><span style={{ color: '#d34444' }}>Enable Maintenance</span><input id="maintenance" type="checkbox" checked={maintenance} onChange={(event) => setMaintenance(event.target.checked)} /></label>
          {maintenance && (
            <>
              <div className="admField"><label htmlFor="maint-msg">Maintenance message</label><input id="maint-msg" className="admInput" defaultValue="We are upgrading service, please check back shortly." /></div>
              <div className="admField"><label htmlFor="maint-duration">Expected duration</label><input id="maint-duration" className="admInput" defaultValue="2 hours" /></div>
            </>
          )}
          <div className="admField"><label htmlFor="play-link">Google Play URL</label><input id="play-link" className="admInput" defaultValue="https://play.google.com/ingo" /></div>
          <div className="admField"><label htmlFor="store-link">Apple App Store URL</label><input id="store-link" className="admInput" defaultValue="https://apps.apple.com/ingo" /></div>
        </div>
        <div className="admQrWrap">
          <div className="admQrMock">QR</div>
          <button className="admLink" type="button">Regenerate QR</button>
        </div>
      </section>

      <section className="admCard admSettingsCard">
        <h3>My Account</h3>
        <div className="admSettingsGrid">
          <div className="admField">
            <label>Avatar</label>
            <div className="admAvatarBig">SA</div>
            <button className="admOutlineBtn" type="button">Upload Avatar</button>
          </div>
          <div className="admField"><label htmlFor="full-name">Full Name</label><input id="full-name" className="admInput" defaultValue="Shuaib Admin" /></div>
          <div className="admField"><label htmlFor="acc-email">Email</label><input id="acc-email" className="admInput" defaultValue="admin@ingo.com" /></div>
          <div className="admField"><label htmlFor="acc-phone">Phone</label><input id="acc-phone" className="admInput" defaultValue="+263 778 112 112" /></div>
          <div className="admField"><label htmlFor="curr-pass">Current password</label><input id="curr-pass" className="admInput" type="password" /></div>
          <div className="admField"><label htmlFor="new-pass">New password</label><input id="new-pass" className="admInput" type="password" /></div>
          <div className="admField"><label htmlFor="confirm-pass">Confirm new password</label><input id="confirm-pass" className="admInput" type="password" /></div>
        </div>
        <div className="admFilters">
          <button className="admBtnSmall" type="button">Update Password</button>
          <button className="admLink" type="button">View My Activity Log</button>
          <button className="admOutlineBtn" type="button" onClick={() => navigate('/admin/system-health')}>Open System Health</button>
        </div>
      </section>
    </div>
  );
}
