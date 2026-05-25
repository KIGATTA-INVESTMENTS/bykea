import { useMemo, useState } from 'react';
import './adminPortal.css';

const tabs = ['All', 'Open', 'In Progress', 'Pending User', 'Resolved', 'Closed'];

const tickets = [
  {
    id: 'SUP-4102',
    subject: 'Unable to track live order',
    category: 'Order Tracking',
    requester: 'Ayesha Tariq',
    channel: 'In-app',
    priority: 'High',
    assigned: 'Sarah Admin',
    created: '25 Apr, 10:12 AM',
    status: 'Open',
  },
  {
    id: 'SUP-4101',
    subject: 'Wallet top up not reflected',
    category: 'Payments',
    requester: 'Bilal Khan',
    channel: 'WhatsApp',
    priority: 'Medium',
    assigned: 'John Support',
    created: '25 Apr, 09:58 AM',
    status: 'In Progress',
  },
  {
    id: 'SUP-4100',
    subject: 'Shop catalog not syncing',
    category: 'Shop Owner',
    requester: 'Green Valley Mart',
    channel: 'Email',
    priority: 'Low',
    assigned: 'Unassigned',
    created: '25 Apr, 09:20 AM',
    status: 'Pending User',
  },
  {
    id: 'SUP-4099',
    subject: 'Driver app keeps logging out',
    category: 'Driver App',
    requester: 'Umair Tariq',
    channel: 'SMS',
    priority: 'High',
    assigned: 'Sarah Admin',
    created: '24 Apr, 08:20 PM',
    status: 'Resolved',
  },
];

const conversation = [
  'Ticket opened by user - 25 Apr 10:12 AM',
  'Assigned to Sarah Admin - 25 Apr 10:15 AM',
  'User shared screenshot - 25 Apr 10:18 AM',
  'Support requested app version - 25 Apr 10:20 AM',
];

function statusClass(status) {
  if (status === 'Open') return 'admBadgeStatus admRed';
  if (status === 'In Progress') return 'admBadgeStatus admBlue';
  if (status === 'Pending User') return 'admBadgeStatus admOrange';
  if (status === 'Resolved') return 'admBadgeStatus admGreen';
  return 'admBadgeStatus admGray';
}

function priorityClass(priority) {
  if (priority === 'High') return 'admBadgeStatus admRed';
  if (priority === 'Medium') return 'admBadgeStatus admOrange';
  return 'admBadgeStatus admBlue';
}

export default function AdminSupportTicketsPage() {
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState('');

  const filtered = useMemo(() => {
    return tickets.filter((ticket) => {
      const q = search.toLowerCase();
      const matchQ =
        !q ||
        ticket.id.toLowerCase().includes(q) ||
        ticket.requester.toLowerCase().includes(q) ||
        ticket.subject.toLowerCase().includes(q);
      const matchTab = activeTab === 'All' || ticket.status === activeTab;
      return matchQ && matchTab;
    });
  }, [activeTab, search]);

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Support Tickets</h2>
        <button className="admBtn admBtnAuto" type="button">Create Ticket</button>
      </div>

      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard"><p className="k">Open Tickets</p><p className="v" style={{ color: '#d34444' }}>18</p></article>
        <article className="admCard admSmallCard"><p className="k">In Progress</p><p className="v" style={{ color: '#0A58A6' }}>11</p></article>
        <article className="admCard admSmallCard"><p className="k">Resolved Today</p><p className="v" style={{ color: '#0A58A6' }}>9</p></article>
        <article className="admCard admSmallCard"><p className="k">Avg First Response</p><p className="v">12 min</p></article>
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
          <div className="admSearch"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticket ID, requester or subject..." /></div>
          <div className="admFilters">
            <select className="admSelect"><option>All Categories</option><option>Payments</option><option>Order Tracking</option><option>Driver App</option><option>Shop Owner</option></select>
            <select className="admSelect"><option>All Priorities</option><option>High</option><option>Medium</option><option>Low</option></select>
          </div>
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable admWideTable">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Subject</th>
                <th>Category</th>
                <th>Requester</th>
                <th>Channel</th>
                <th>Priority</th>
                <th>Assigned To</th>
                <th>Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticket) => (
                <tr key={ticket.id} className="admClickableRow" onClick={() => setSelected(ticket)}>
                  <td><button className="admLink" type="button">{ticket.id}</button></td>
                  <td>{ticket.subject}</td>
                  <td><span className="admBadgeStatus admGray">{ticket.category}</span></td>
                  <td>{ticket.requester}</td>
                  <td className="admDim">{ticket.channel}</td>
                  <td><span className={priorityClass(ticket.priority)}>{ticket.priority}</span></td>
                  <td>{ticket.assigned === 'Unassigned' ? <span className="admUnassigned">Unassigned</span> : ticket.assigned}</td>
                  <td className="admDim">{ticket.created}</td>
                  <td><span className={statusClass(ticket.status)}>{ticket.status}</span></td>
                  <td>
                    <div className="admActions">
                      <button type="button" aria-label="View">👁</button>
                      <button type="button" aria-label="Assign" style={{ color: '#0A58A6' }}>✓</button>
                      <button type="button" aria-label="Close" style={{ color: '#d34444' }}>✕</button>
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
          <strong>Ticket Detail</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelected(null)} aria-label="Close panel">✕</button>
        </div>
        <div className="admPanelBody">
          {selected && (
            <>
              <section className="admPanelBlock">
                <h3 style={{ margin: 0 }}>{selected.id}</h3>
                <p style={{ margin: '0.3rem 0' }}>{selected.subject}</p>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <span className="admBadgeStatus admGray">{selected.category}</span>
                  <span className={priorityClass(selected.priority)}>{selected.priority}</span>
                  <span className={statusClass(selected.status)}>{selected.status}</span>
                </div>
                <p className="admDim">{selected.created}</p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Requester</h4>
                <div className="admInlineUser"><span className="admMiniAvatar">{selected.requester.slice(0, 2).toUpperCase()}</span><strong>{selected.requester}</strong></div>
                <p className="admDim">Channel: {selected.channel}</p>
                <button className="admLink" type="button">View Profile</button>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Conversation Timeline</h4>
                <div className="admTimeline">
                  {conversation.map((row) => (
                    <div className="admTimelineRow" key={row}>
                      <span className="admTimelineDot done" />
                      <div>{row}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Support Reply</h4>
                <textarea className="admTextarea" placeholder="Type response to user..." value={reply} onChange={(event) => setReply(event.target.value)} />
                <div className="admPanelActions admActions2">
                  <button className="admBtnSmall" type="button">Send Reply</button>
                  <button className="admOutlineBtn" type="button">Save Internal Note</button>
                </div>
              </section>

              <section className="admPanelActions admActions2">
                <button className="admBtnSmall" type="button">Mark Resolved</button>
                <button className="admWarnBtnSmall" type="button">Assign Agent</button>
                <button className="admDangerSmall" type="button">Close Ticket</button>
                <button className="admOutlineBtn" type="button">Escalate</button>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
