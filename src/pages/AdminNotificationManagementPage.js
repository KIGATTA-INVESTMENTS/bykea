import { useState } from 'react';
import './adminPortal.css';

const tabs = ['Sent', 'Scheduled', 'Templates'];

const sentRows = [
  { title: 'Driver Bonus Alert', msg: 'Bonus payout credited for top performers this week.', recipients: '3,820 drivers', date: '25 Apr 09:10', delivered: 3792, failed: 28 },
  { title: 'Weekend Promo', msg: 'Get 20% off all delivery orders this weekend.', recipients: '12,450 customers', date: '24 Apr 14:30', delivered: 12320, failed: 130 },
];
const scheduledRows = [
  { title: 'Maintenance Notice', recipients: 'All users', date: '26 Apr 01:00 AM' },
  { title: 'Driver Safety Reminder', recipients: 'All drivers', date: '27 Apr 09:00 AM' },
];
const templates = [
  { name: 'Order Confirmed', text: 'Your order has been confirmed and is being prepared.', used: 'Today' },
  { name: 'Driver Assigned', text: 'A driver has been assigned to your request.', used: 'Yesterday' },
  { name: 'Issue Resolved', text: 'Your issue has been resolved. Thank you for your patience.', used: '2 days ago' },
];

export default function AdminNotificationManagementPage() {
  const [activeTab, setActiveTab] = useState('Sent');

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Notifications</h2>
        <button className="admBtn admBtnAuto" type="button">Send New</button>
      </div>

      <section className="admTabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
        ))}
      </section>

      {activeTab === 'Sent' && (
        <section className="admCard">
          {sentRows.map((row) => (
            <div key={row.title} className="admNotifRow">
              <div><strong>{row.title}</strong><p className="admDim">{row.msg}</p></div>
              <div className="admDim">{row.recipients}</div>
              <div className="admDim">📲 ✉ SMS WA</div>
              <div className="admDim">{row.date}</div>
              <div style={{ color: '#0A58A6' }}>{row.delivered} delivered</div>
              <div style={{ color: '#d34444' }}>{row.failed} failed</div>
              <button className="admLink" type="button">View Details</button>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'Scheduled' && (
        <section className="admCard">
          {scheduledRows.map((row) => (
            <div key={row.title} className="admNotifRow admNotifScheduleRow">
              <div><strong>{row.title}</strong><p className="admDim">{row.recipients}</p></div>
              <div className="admDim">{row.date}</div>
              <div className="admDim">📲 ✉ SMS WA</div>
              <button className="admLink" type="button">Edit</button>
              <button className="admDangerInline" type="button">Cancel</button>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'Templates' && (
        <section>
          <div className="admToolbar" style={{ marginBottom: '0.6rem' }}>
            <div />
            <button className="admBtnSmall" type="button">Add Template</button>
          </div>
          <div className="admReportsGrid">
            {templates.map((item) => (
              <article className="admCard" key={item.name}>
                <strong>{item.name}</strong>
                <p className="admDim">{item.text}</p>
                <small className="admDim">Last used: {item.used}</small>
                <div className="admFilters">
                  <button className="admBtnSmall" type="button">Use Template</button>
                  <button type="button" className="admOutlineBtn">✎</button>
                  <button type="button" className="admDangerInline">🗑</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
