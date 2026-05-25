import { useMemo, useState } from 'react';
import './adminPortal.css';

const drivers = [
  { id: 'DR-201', name: 'Hassan Raza', phone: '+44 7700 555840', vehicle: 'Bike', plate: 'AB19 CDE', deliveries: 412, rating: 4.8, deposit: '¬$142', status: 'Online', completion: '97%', onlineHours: '52h' },
  { id: 'DR-202', name: 'Noman Shah', phone: '+44 7700 889002', vehicle: 'Car', plate: 'LM20 FGH', deliveries: 280, rating: 4.6, deposit: '¬$88', status: 'Offline', completion: '95%', onlineHours: '38h' },
  { id: 'DR-203', name: 'Saif Malik', phone: '+44 7700 901117', vehicle: 'Bike', plate: 'YN68 JKL', deliveries: 0, rating: 0, deposit: '¬$40', status: 'Pending', completion: '--', onlineHours: '--' },
  { id: 'DR-204', name: 'Adeel Hanif', phone: '+44 7700 772334', vehicle: 'Van', plate: 'CK19 MNO', deliveries: 104, rating: 4.4, deposit: '¬$55', status: 'Suspended', completion: '89%', onlineHours: '21h' },
  { id: 'DR-205', name: 'Umair Tariq', phone: '+44 7700 991200', vehicle: 'Bike', plate: 'DP21 PQR', deliveries: 188, rating: 4.7, deposit: '¬$73', status: 'Online', completion: '96%', onlineHours: '43h' },
];

const tabs = ['All', 'Online', 'Offline', 'Pending', 'Suspended', 'Rejected'];

function statusClass(status) {
  if (status === 'Online') return 'admBadgeStatus admGreen';
  if (status === 'Pending') return 'admBadgeStatus admOrange';
  if (status === 'Suspended') return 'admBadgeStatus admRed';
  if (status === 'Rejected') return 'admBadgeStatus admRed';
  return 'admBadgeStatus admGray';
}

export default function AdminDriverManagementPage() {
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const filteredDrivers = useMemo(() => {
    return drivers.filter((driver) => {
      const query = search.toLowerCase();
      const matchSearch = !query
        || driver.name.toLowerCase().includes(query)
        || driver.phone.toLowerCase().includes(query)
        || driver.vehicle.toLowerCase().includes(query);
      const matchTab = activeTab === 'All' || driver.status === activeTab;
      return matchSearch && matchTab;
    });
  }, [activeTab, search]);

  const pendingDriver = drivers.find((driver) => driver.status === 'Pending');

  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>Driver Management</h2>
        <button className="admOutlineBtn" type="button">Export</button>
      </div>

      <section className="admGrid4" style={{ marginBottom: '0.8rem' }}>
        <article className="admCard admSmallCard"><p className="k">Total Drivers</p><p className="v">348</p></article>
        <article className="admCard admSmallCard"><p className="k">Online Now</p><p className="v" style={{ color: '#0A58A6' }}>86</p></article>
        <article className="admCard admSmallCard"><p className="k">Pending Approval</p><p className="v" style={{ color: '#ec9120' }}>12</p></article>
        <article className="admCard admSmallCard"><p className="k">Suspended</p><p className="v" style={{ color: '#d34444' }}>5</p></article>
      </section>

      <section className="admTabs">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSearch">
          <input
            placeholder="Search by name, phone, vehicle..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admTableWrap">
          <table className="admTable">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Phone Number</th>
                <th>Vehicle Type</th>
                <th>Plate Number</th>
                <th>Total Deliveries</th>
                <th>Rating</th>
                <th>Deposit Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => (
                <tr key={driver.id} className="admClickableRow" onClick={() => setSelectedDriver(driver)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span className="admAvatar" style={{ width: 30, height: 30, fontSize: '0.7rem' }}>{driver.name.slice(0, 2).toUpperCase()}</span>
                      {driver.name}
                    </div>
                  </td>
                  <td>{driver.phone}</td>
                  <td><span className="admBadgeStatus admBlue">{driver.vehicle}</span></td>
                  <td>{driver.plate}</td>
                  <td>{driver.deliveries}</td>
                  <td style={{ color: '#0A58A6' }}>{driver.rating ? `${driver.rating} ‚òÖ` : '--'}</td>
                  <td>{driver.deposit}</td>
                  <td><span className={statusClass(driver.status)}>{driver.status}</span></td>
                  <td>
                    <div className="admActions">
                      <button type="button" aria-label="View">üëÅ</button>
                      <button type="button" aria-label="Approve" style={{ color: '#0A58A6' }}>‚úì</button>
                      <button type="button" aria-label="Reject" style={{ color: '#d34444' }}>‚úï</button>
                      <button type="button" aria-label="Suspend" style={{ color: '#ec9120' }}>‚õî</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pendingDriver && (
        <section className="admCard" style={{ border: '1px solid #ffd8b0', marginBottom: '0.8rem' }}>
          <div className="admSectionHeader">
            <h3>
              <span className="admBadgeStatus admOrange" style={{ marginRight: '0.35rem' }}>Awaiting Approval</span>
              Pending Approval
            </h3>
          </div>
          <p style={{ marginTop: 0 }}>
            {pendingDriver.name} ({pendingDriver.phone}) - {pendingDriver.vehicle} / {pendingDriver.plate}
          </p>
          <div style={{ marginBottom: '0.6rem' }}>
            <strong>Documents submitted:</strong>
            <div style={{ marginTop: '0.25rem' }}>
              CNIC <button className="admLink" type="button">View</button> | License <button className="admLink" type="button">View</button> | Vehicle Card <button className="admLink" type="button">View</button>
            </div>
          </div>
          <div className="admGrid2">
            <button className="admBtn" type="button">Approve Driver</button>
            <button className="admDangerBtn" type="button">Reject Application</button>
          </div>
          <div style={{ marginTop: '0.6rem' }}>
            <label htmlFor="reject-reason" style={{ display: 'block', fontWeight: 700, marginBottom: '0.3rem' }}>Rejection reason</label>
            <input
              id="reject-reason"
              className="admInput"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Reason required for rejection"
            />
          </div>
        </section>
      )}

      <aside className={`admPanel${selectedDriver ? ' open' : ''}`}>
        <div className="admPanelHead">
          <strong>Driver Detail</strong>
          <button className="admIconBtn" type="button" onClick={() => setSelectedDriver(null)} aria-label="Close panel">‚úï</button>
        </div>
        <div className="admPanelBody">
          {selectedDriver && (
            <>
              <div className="admPanelBlock" style={{ textAlign: 'center' }}>
                <span className="admAvatar" style={{ width: 66, height: 66, margin: '0 auto 0.42rem', fontSize: '1.05rem' }}>
                  {selectedDriver.name.slice(0, 2).toUpperCase()}
                </span>
                <h3 style={{ margin: 0 }}>{selectedDriver.name}</h3>
                <p style={{ margin: '0.2rem 0 0.35rem', color: '#0A58A6' }}>
                  {selectedDriver.rating ? `${selectedDriver.rating} ‚òÖ` : 'No ratings yet'}
                </p>
                <span className={statusClass(selectedDriver.status)}>{selectedDriver.status}</span>
              </div>

              <div className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Vehicle Details</h4>
                <p style={{ marginBottom: '0.2rem' }}>{selectedDriver.vehicle}</p>
                <p style={{ margin: 0 }}>{selectedDriver.plate}</p>
              </div>

              <div className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Documents</h4>
                <p style={{ marginBottom: '0.3rem' }}>License <button className="admLink" type="button">View</button> <span className="admBadgeStatus admGreen">Verified</span></p>
                <p style={{ marginBottom: '0.3rem' }}>CNIC <button className="admLink" type="button">View</button> <span className="admBadgeStatus admGreen">Verified</span></p>
                <p style={{ margin: 0 }}>Vehicle Card <button className="admLink" type="button">View</button> <span className="admBadgeStatus admGreen">Verified</span></p>
              </div>

              <div className="admGrid2" style={{ marginBottom: '0.7rem' }}>
                <div className="admPanelBlock"><strong>{selectedDriver.deliveries}</strong><p style={{ margin: 0, color: '#777' }}>Total Deliveries</p></div>
                <div className="admPanelBlock"><strong>{selectedDriver.completion}</strong><p style={{ margin: 0, color: '#777' }}>Completion Rate</p></div>
                <div className="admPanelBlock"><strong>{selectedDriver.rating || '--'}</strong><p style={{ margin: 0, color: '#777' }}>Average Rating</p></div>
                <div className="admPanelBlock"><strong>{selectedDriver.onlineHours}</strong><p style={{ margin: 0, color: '#777' }}>Online Hours</p></div>
              </div>

              <div className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Earnings Summary</h4>
                <p style={{ marginBottom: '0.3rem' }}>This week: <strong style={{ color: '#0A58A6' }}>¬$182</strong></p>
                <p style={{ margin: 0 }}>This month: <strong style={{ color: '#0A58A6' }}>¬$734</strong></p>
              </div>

              <div className="admPanelBlock">
                <h4 style={{ marginTop: 0 }}>Deposit Balance &amp; Transactions</h4>
                <p style={{ marginBottom: '0.3rem' }}>Balance: <strong>{selectedDriver.deposit}</strong></p>
                <p style={{ margin: 0, color: '#666' }}>+ ¬$20 (Top-up), - ¬$8 (Penalty), + ¬$15 (Bonus)</p>
              </div>

              <div className="admPanelActions">
                <button className="admDangerBtn" type="button">Suspend</button>
                <button className="admOutlineBtn" type="button">Unsuspend</button>
                <button className="admOutlineBtn" type="button">Send Message</button>
                <button className="admBtn" type="button">View Orders</button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
