import { useMemo, useState } from 'react';
import './adminPortal.css';

const tabs = ['All', 'Open', 'In Review', 'Resolved', 'Closed'];

const disputes = [
  {
    id: 'DSP-2401',
    type: 'Delivery Issue',
    customer: 'Ayesha Tariq',
    driver: 'Bilal Khan',
    orderId: 'IG-13021',
    description: 'Order arrived 45 minutes late and item was cold on delivery.',
    priority: 'High',
    opened: '25 Apr, 09:20 AM',
    status: 'Open',
  },
  {
    id: 'DSP-2400',
    type: 'Payment Issue',
    customer: 'Usman Ali',
    driver: 'Raza Ahmed',
    orderId: 'IG-13019',
    description: 'Card charged twice while checkout confirmed only one order.',
    priority: 'Medium',
    opened: '25 Apr, 08:55 AM',
    status: 'In Review',
  },
  {
    id: 'DSP-2398',
    type: 'Driver Complaint',
    customer: 'Nida Khan',
    driver: 'Hassan Raza',
    orderId: 'IG-13012',
    description: 'Customer reported rude behavior during handover.',
    priority: 'Low',
    opened: '24 Apr, 07:38 PM',
    status: 'Resolved',
  },
  {
    id: 'DSP-2396',
    type: 'Wrong Item',
    customer: 'Shahbaz Noor',
    driver: 'Adeel Malik',
    orderId: 'IG-12998',
    description: 'Received wrong grocery pack from partner shop.',
    priority: 'High',
    opened: '24 Apr, 03:18 PM',
    status: 'Closed',
  },
  {
    id: 'DSP-2395',
    type: 'Damaged Package',
    customer: 'Hina Faisal',
    driver: 'Umair Tariq',
    orderId: 'IG-12997',
    description: 'Package was torn and product damaged on arrival.',
    priority: 'Medium',
    opened: '24 Apr, 01:11 PM',
    status: 'Open',
  },
];

const timeline = [
  'Dispute opened - 25 Apr, 09:20 AM',
  'Assigned to admin Sarah - 25 Apr, 09:24 AM',
  'Customer responded with photo - 25 Apr, 09:29 AM',
  'Driver responded with pickup note - 25 Apr, 09:35 AM',
];

function typeClass(type) {
  if (type === 'Delivery Issue') return 'admBadgeStatus admRed';
  if (type === 'Payment Issue') return 'admBadgeStatus admOrange';
  if (type === 'Driver Complaint') return 'admBadgeStatus admPurple';
  if (type === 'Wrong Item') return 'admBadgeStatus admBlue';
  return 'admBadgeStatus admBrown';
}

function priorityClass(priority) {
  if (priority === 'High') return 'admBadgeStatus admRed';
  if (priority === 'Medium') return 'admBadgeStatus admOrange';
  return 'admBadgeStatus admBlue';
}

function statusClass(status) {
  if (status === 'Open') return 'admBadgeStatus admRed';
  if (status === 'In Review') return 'admBadgeStatus admOrange';
  if (status === 'Resolved') return 'admBadgeStatus admGreen';
  return 'admBadgeStatus admGray';
}

export default function AdminDisputesSupportPage() {
  const [activeTab, setActiveTab] = useState('All');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');

  const filtered = useMemo(
    () =>
      disputes.filter((item) => {
        const q = query.toLowerCase();
        const matchQ =
          !q ||
          item.id.toLowerCase().includes(q) ||
          item.customer.toLowerCase().includes(q) ||
          item.orderId.toLowerCase().includes(q);
        const matchTab = activeTab === 'All' || item.status === activeTab;
        const matchType = typeFilter === 'All Types' || item.type === typeFilter;
        const matchPriority = priorityFilter === 'All' || item.priority === priorityFilter;
        return matchQ && matchTab && matchType && matchPriority;
      }),
    [activeTab, priorityFilter, query, typeFilter],
  );

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Disputes &amp; Support</h2>
        <button className="admOutlineBtn" type="button">
          Export
        </button>
      </div>

      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#d34444' }}>
          <h4>Open Disputes</h4>
          <p className="v" style={{ color: '#d34444' }}>
            24
          </p>
          <p className="s" style={{ color: '#d34444' }}>
            Needs attention
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#ec9120' }}>
          <h4>In Review</h4>
          <p className="v" style={{ color: '#ec9120' }}>
            12
          </p>
          <p className="s" style={{ color: '#ec9120' }}>
            Being investigated
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Resolved Today</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            8
          </p>
          <p className="s" style={{ color: '#0A58A6' }}>
            Successfully closed
          </p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Avg Resolution Time</h4>
          <p className="v" style={{ color: '#0A58A6' }}>
            4.2 hrs
          </p>
          <p className="s admDim">Last 30 days</p>
        </article>
      </section>

      <section className="admTabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search dispute ID, customer or order..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="admFilters">
            <select className="admSelect" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option>All Types</option>
              <option>Delivery Issue</option>
              <option>Payment Issue</option>
              <option>Driver Complaint</option>
              <option>Wrong Item</option>
              <option>Damaged Package</option>
              <option>Other</option>
            </select>
            <select
              className="admSelect"
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option>All</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable admWideTable">
            <thead>
              <tr>
                <th>Dispute ID</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Driver</th>
                <th>Order ID</th>
                <th>Description</th>
                <th>Priority</th>
                <th>Opened</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="admClickableRow" onClick={() => setSelected(item)}>
                  <td>
                    <button className="admLink" type="button">
                      {item.id}
                    </button>
                  </td>
                  <td>
                    <span className={typeClass(item.type)}>{item.type}</span>
                  </td>
                  <td>
                    <div className="admInlineUser">
                      <span className="admMiniAvatar">{item.customer.slice(0, 2).toUpperCase()}</span>
                      {item.customer}
                    </div>
                  </td>
                  <td>
                    <div className="admInlineUser">
                      <span className="admMiniAvatar">{item.driver.slice(0, 2).toUpperCase()}</span>
                      {item.driver}
                    </div>
                  </td>
                  <td>
                    <button className="admLink" type="button">
                      {item.orderId}
                    </button>
                  </td>
                  <td className="admTruncate">{item.description}</td>
                  <td>
                    <span className={priorityClass(item.priority)}>{item.priority}</span>
                  </td>
                  <td className="admDim">{item.opened}</td>
                  <td>
                    <span className={statusClass(item.status)}>{item.status}</span>
                  </td>
                  <td>
                    <div className="admActions">
                      <button type="button" aria-label="View">
                        👁
                      </button>
                      <button type="button" aria-label="Resolve" style={{ color: '#0A58A6' }}>
                        ✓
                      </button>
                      <button type="button" aria-label="Close" style={{ color: '#d34444' }}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={`admPanel${selected ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Dispute Detail</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelected(null)} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div className="admPanelBody">
          {selected && (
            <>
              <section className="admPanelBlock">
                <h3 style={{ margin: 0 }}>{selected.id}</h3>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                  <span className={typeClass(selected.type)}>{selected.type}</span>
                  <span className={priorityClass(selected.priority)}>{selected.priority}</span>
                  <span className={statusClass(selected.status)}>{selected.status}</span>
                </div>
                <p className="admDim">{selected.opened}</p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Parties Involved</h4>
                <div className="admParties2">
                  <div>
                    <div className="admInlineUser">
                      <span className="admMiniAvatar">AT</span>
                      <strong>{selected.customer}</strong>
                    </div>
                    <p className="admDim">+44 7700 445212</p>
                    <button className="admLink" type="button">
                      View Profile
                    </button>
                  </div>
                  <div>
                    <div className="admInlineUser">
                      <span className="admMiniAvatar">BK</span>
                      <strong>{selected.driver}</strong>
                    </div>
                    <p className="admDim">+44 7700 772140</p>
                    <button className="admLink" type="button">
                      View Profile
                    </button>
                  </div>
                </div>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Related Order</h4>
                <p style={{ margin: '0.2rem 0' }}>
                  <button className="admLink" type="button">
                    {selected.orderId}
                  </button>
                </p>
                <p className="admDim">Route: Stratford, London E15 → Kings Cross, London N1C</p>
                <p className="admDim">Amount �$12.40 - 25 Apr 2026</p>
                <button className="admBtnSmall" type="button">
                  View Order
                </button>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Issue Description</h4>
                <p>{selected.description}</p>
                <div className="admEvidenceRow">
                  <div className="admEvidenceThumb">Evidence 1</div>
                  <div className="admEvidenceThumb">Evidence 2</div>
                </div>
                <button className="admLink" type="button">
                  View
                </button>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Dispute Timeline</h4>
                <div className="admTimeline">
                  {timeline.map((row) => (
                    <div className="admTimelineRow" key={row}>
                      <span className="admTimelineDot done" />
                      <div>{row}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Admin Response</h4>
                <p className="admDim">Previous note: Requested additional image evidence from customer.</p>
                <textarea
                  className="admTextarea"
                  placeholder="Add internal note..."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <label className="admToggleRow" htmlFor="visible-to-parties">
                  <span>Visible to parties</span>
                  <input id="visible-to-parties" type="checkbox" defaultChecked />
                </label>
                <button className="admBtnSmall" type="button">
                  Add Note
                </button>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Resolution</h4>
                <div className="admField">
                  <label htmlFor="resolution-type">Resolution Type</label>
                  <select id="resolution-type" className="admSelect">
                    <option>Full Refund</option>
                    <option>Partial Refund</option>
                    <option>No Refund</option>
                    <option>Warning Issued</option>
                    <option>Driver Suspended</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="admField">
                  <label htmlFor="resolution-amount">Resolution amount</label>
                  <input id="resolution-amount" className="admInput" placeholder="�$0.00" />
                </div>
                <textarea className="admTextarea" placeholder="Resolution notes" />
                <div className="admPanelActions admActions2">
                  <button className="admBtnSmall" type="button">
                    Mark Resolved
                  </button>
                  <button className="admWarnBtnSmall" type="button">
                    Escalate
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
