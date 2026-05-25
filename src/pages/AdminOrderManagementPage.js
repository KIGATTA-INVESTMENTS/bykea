import { useMemo, useState } from 'react';
import './adminPortal.css';

const tabs = ['All', 'Pending', 'Assigned', 'In Transit', 'Delivered', 'Cancelled'];

const orders = [
  { id: 'IG-13021', service: 'Delivery', customer: 'Ayesha Tariq', driver: 'Bilal Khan', pickup: 'Stratford, London E15', dropoff: 'Kings Cross, London N1C', amount: '�$12.40', payment: 'Bank', datetime: '25 Apr, 09:40 AM', status: 'In Transit' },
  { id: 'IG-13020', service: 'Taxi', customer: 'Usman Ali', driver: 'Raza Ahmed', pickup: 'Westminster, London SW1', dropoff: 'Covent Garden, London WC2', amount: '�$8.60', payment: 'Card', datetime: '25 Apr, 09:27 AM', status: 'Assigned' },
  { id: 'IG-13019', service: 'Shop', customer: 'Nida Khan', driver: 'Unassigned', pickup: 'Green Valley Mart, Stratford', dropoff: 'Notting Hill, London W11', amount: '�$26.20', payment: 'Wallet', datetime: '25 Apr, 09:11 AM', status: 'Pending' },
  { id: 'IG-13018', service: 'Delivery', customer: 'Shahbaz Noor', driver: 'Adeel Malik', pickup: 'Liverpool Street, London EC2', dropoff: 'Canary Wharf, London E14', amount: '�$11.00', payment: 'Cash', datetime: '25 Apr, 08:58 AM', status: 'Delivered' },
  { id: 'IG-13017', service: 'Taxi', customer: 'Hina Faisal', driver: 'Kashif Umar', pickup: 'Paddington, London W2', dropoff: 'London Bridge, London SE1', amount: '�$6.90', payment: 'Bank', datetime: '25 Apr, 08:41 AM', status: 'Cancelled' },
];

const timeline = [
  { label: 'Order Placed', time: '09:18 AM', done: true },
  { label: 'Driver Assigned', time: '09:22 AM', done: true },
  { label: 'Picked Up', time: '09:28 AM', done: true },
  { label: 'In Transit', time: '09:32 AM', active: true },
  { label: 'Delivered', time: '--', muted: true },
];

function statusClass(status) {
  if (status === 'Delivered') return 'admBadgeStatus admGreen';
  if (status === 'Cancelled') return 'admBadgeStatus admRed';
  if (status === 'In Transit') return 'admBadgeStatus admBlue';
  if (status === 'Assigned') return 'admBadgeStatus admPurple';
  return 'admBadgeStatus admOrange';
}

function serviceClass(service) {
  if (service === 'Delivery') return 'admBadgeStatus admGreen';
  if (service === 'Taxi') return 'admBadgeStatus admBlue';
  return 'admBadgeStatus admPurple';
}

export default function AdminOrderManagementPage() {
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [selectedOrder, setSelectedOrder] = useState(null);

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      const q = search.toLowerCase();
      const matchQ = !q
        || order.id.toLowerCase().includes(q)
        || order.customer.toLowerCase().includes(q)
        || order.driver.toLowerCase().includes(q);
      const matchTab = activeTab === 'All' || order.status === activeTab;
      const matchService = serviceFilter === 'All' || order.service === serviceFilter;
      const matchPayment = paymentFilter === 'All' || order.payment === paymentFilter;
      return matchQ && matchTab && matchService && matchPayment;
    });
  }, [activeTab, paymentFilter, search, serviceFilter]);

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Order Management</h2>
        <div className="admFilters">
          <input className="admInput admDateInput" defaultValue="01 Apr - 25 Apr 2026" />
          <button className="admOutlineBtn" type="button">Export</button>
        </div>
      </div>

      <section className="admGrid4" style={{ marginBottom: '0.85rem' }}>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Total Orders Today</h4>
          <p className="v">1,240</p>
          <p className="s" style={{ color: '#0A58A6' }}>+8% from yesterday</p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#ec9120' }}>
          <h4>Active Orders</h4>
          <p className="v" style={{ color: '#ec9120' }}>84</p>
          <p className="s" style={{ color: '#ec9120' }}>In progress now</p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#0A58A6' }}>
          <h4>Completed Today</h4>
          <p className="v" style={{ color: '#0A58A6' }}>1,089</p>
          <p className="s" style={{ color: '#0A58A6' }}>87.8% completion rate</p>
        </article>
        <article className="admCard admStat" style={{ borderLeftColor: '#d34444' }}>
          <h4>Cancelled Today</h4>
          <p className="v" style={{ color: '#d34444' }}>67</p>
          <p className="s" style={{ color: '#d34444' }}>5.4% cancellation rate</p>
        </article>
      </section>

      <section className="admTabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.85rem' }}>
        <div className="admToolbar" style={{ marginBottom: 0 }}>
          <div className="admSearch">
            <input
              placeholder="Search order ID, customer or driver..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="admFilters">
            <select className="admSelect" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
              <option>All</option>
              <option>Delivery</option>
              <option>Taxi</option>
              <option>Shop</option>
            </select>
            <select className="admSelect" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              <option>All</option>
              <option>Cash</option>
              <option>Bank</option>
              <option>Card</option>
              <option>Wallet</option>
            </select>
          </div>
        </div>
      </section>

      <section className="admCard">
        <div className="admTableWrap">
          <table className="admTable admWideTable">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Service</th>
                <th>Customer</th>
                <th>Driver</th>
                <th>Pickup</th>
                <th>Dropoff</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Date &amp; Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} className="admClickableRow" onClick={() => setSelectedOrder(order)}>
                  <td><button className="admLink" type="button">{order.id}</button></td>
                  <td><span className={serviceClass(order.service)}>{order.service}</span></td>
                  <td><div className="admInlineUser"><span className="admMiniAvatar">{order.customer.slice(0, 2).toUpperCase()}</span>{order.customer}</div></td>
                  <td>
                    {order.driver === 'Unassigned'
                      ? <span className="admUnassigned">Unassigned</span>
                      : <div className="admInlineUser"><span className="admMiniAvatar">{order.driver.slice(0, 2).toUpperCase()}</span>{order.driver}</div>}
                  </td>
                  <td className="admDim">{order.pickup}</td>
                  <td className="admDim">{order.dropoff}</td>
                  <td style={{ fontWeight: 700 }}>{order.amount}</td>
                  <td>{order.payment}</td>
                  <td className="admDim">{order.datetime}</td>
                  <td><span className={statusClass(order.status)}>{order.status}</span></td>
                  <td>
                    <div className="admActions">
                      <button type="button" aria-label="View Details">👁</button>
                      <button type="button" aria-label="Assign Driver">🚚</button>
                      <button type="button" aria-label="Flag Dispute">⚑</button>
                      <button type="button" aria-label="Cancel Order" style={{ color: '#d34444' }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={`admPanel${selectedOrder ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Order Detail</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelectedOrder(null)} aria-label="Close panel">✕</button>
        </div>
        <div className="admPanelBody">
          {selectedOrder && (
            <>
              <section className="admPanelBlock">
                <div className="admSectionHeader" style={{ marginBottom: '0.2rem' }}>
                  <h3 style={{ margin: 0 }}>{selectedOrder.id}</h3>
                  <span className={serviceClass(selectedOrder.service)}>{selectedOrder.service}</span>
                </div>
                <span className={statusClass(selectedOrder.status)} style={{ fontSize: '0.78rem' }}>{selectedOrder.status}</span>
                <p className="admDim" style={{ marginBottom: 0 }}>{selectedOrder.datetime}</p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Timeline</h4>
                <div className="admTimeline">
                  {timeline.map((step) => (
                    <div key={step.label} className="admTimelineRow">
                      <span className={`admTimelineDot${step.done ? ' done' : ''}${step.active ? ' pulse' : ''}${step.muted ? ' muted' : ''}`} />
                      <div>
                        <div style={{ fontWeight: 700 }}>{step.label}</div>
                        <div className="admDim">{step.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Customer</h4>
                <div className="admInlineUser"><span className="admMiniAvatar">AT</span><strong>{selectedOrder.customer}</strong></div>
                <p className="admDim">+44 7700 443112</p>
                <p className="admDim">Total orders: 42</p>
                <button className="admLink" type="button">View Profile</button>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Driver</h4>
                {selectedOrder.driver === 'Unassigned' ? (
                  <>
                    <p className="admUnassigned">Unassigned</p>
                    <button className="admBtn" type="button">Assign Driver</button>
                    <select className="admSelect" style={{ marginTop: '0.45rem' }}>
                      <option>Select available driver</option>
                      <option>Bilal Khan - Bike - LEA 121</option>
                      <option>Raza Ahmed - Car - ISB 987</option>
                    </select>
                  </>
                ) : (
                  <>
                    <div className="admInlineUser"><span className="admMiniAvatar">BK</span><strong>{selectedOrder.driver}</strong></div>
                    <p className="admDim">Bike - LEA 121</p>
                    <p style={{ color: '#0A58A6' }}>★★★★☆ 4.8</p>
                    <button className="admLink" type="button">View Profile</button>
                  </>
                )}
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Route</h4>
                <div className="admMapMock">Route Map Placeholder</div>
                <p style={{ margin: '0.4rem 0 0.2rem' }}><span className="admDotGreen" /> {selectedOrder.pickup}</p>
                <p className="admDashLine">- - - - - - - - -</p>
                <p style={{ margin: '0.2rem 0' }}><span className="admDotRed" /> {selectedOrder.dropoff}</p>
                <p className="admDim">Distance 8.4 km - Duration 22 min</p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Package / Order Details</h4>
                <p style={{ margin: '0.2rem 0' }}>Type: Grocery Package (Medium)</p>
                <p className="admDim">Special instructions: Leave at gate and call on arrival.</p>
                <p style={{ margin: '0.3rem 0 0.1rem' }}>Items: 2x Milk, 1x Bread, 1x Eggs</p>
              </section>

              <section className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Payment</h4>
                <p style={{ margin: '0.2rem 0' }}>Method: {selectedOrder.payment}</p>
                <p className="admDim">Base fare: �$8.00 | Distance: �$3.40 | Service fee: �$1.00</p>
                <p style={{ color: '#0A58A6', fontWeight: 800, marginBottom: '0.2rem' }}>Total: {selectedOrder.amount}</p>
                <span className="admBadgeStatus admGreen">Paid</span>
              </section>

              <section className="admPanelActions">
                <button className="admOutlineBtn" type="button">Reassign Driver</button>
                <button className="admDangerBtn" type="button">Cancel Order</button>
                <button className="admWarnBtn" type="button">Flag Dispute</button>
                <button className="admInfoBtn" type="button">Send Notification</button>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
