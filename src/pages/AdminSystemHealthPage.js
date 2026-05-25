import './adminPortal.css';

const services = [
  { name: 'API Server', status: 'Operational', uptime: '99.98%', response: '120ms', incident: 'No recent incidents' },
  { name: 'Database', status: 'Operational', uptime: '99.99%', response: '95ms', incident: 'No recent incidents' },
  { name: 'Payment Gateway', status: 'Degraded', uptime: '98.70%', response: '430ms', incident: 'Latency spike 2h ago' },
  { name: 'Maps Service', status: 'Operational', uptime: '99.60%', response: '140ms', incident: 'No recent incidents' },
  { name: 'SMS Service', status: 'Down', uptime: '92.20%', response: 'N/A', incident: 'Provider outage ongoing' },
  { name: 'Email Service', status: 'Operational', uptime: '99.40%', response: '180ms', incident: 'No recent incidents' },
  { name: 'Push Notifications', status: 'Operational', uptime: '99.73%', response: '100ms', incident: 'No recent incidents' },
  { name: 'File Storage', status: 'Operational', uptime: '99.82%', response: '110ms', incident: 'No recent incidents' },
];

const incidents = [
  { service: 'Payment Gateway', description: 'High latency in checkout callbacks', duration: '37 mins', resolved: '25 Apr, 12:20 PM', status: 'Resolved' },
  { service: 'SMS Service', description: 'External provider API timeout', duration: '2 hrs', resolved: 'Ongoing', status: 'Ongoing' },
];

function dotClass(status) {
  if (status === 'Operational') return 'admStatusDot green';
  if (status === 'Degraded') return 'admStatusDot orange';
  return 'admStatusDot red';
}

export default function AdminSystemHealthPage() {
  return (
    <div className="adm">
      <div className="admToolbar">
        <h2 style={{ margin: 0 }}>System Health</h2>
        <div className="admFilters">
          <button className="admOutlineBtn" type="button">Refresh</button>
          <small className="admDim">Last refreshed: 2 mins ago</small>
        </div>
      </div>

      <section className="admHealthBanner ok">
        <span style={{ fontSize: '1.4rem' }} aria-hidden>✓</span>
        <strong>All Systems Normal</strong>
      </section>

      <section className="admGrid2" style={{ marginBottom: '0.8rem' }}>
        {services.map((service) => (
          <article key={service.name} className="admCard">
            <div className="admSectionHeader" style={{ marginBottom: '0.2rem' }}>
              <h3 style={{ fontSize: '0.96rem' }}>{service.name}</h3>
              <span className={dotClass(service.status)} />
            </div>
            <p className="admDim" style={{ margin: '0.15rem 0' }}>{service.status}</p>
            <p style={{ margin: '0.15rem 0', color: '#0A58A6', fontWeight: 700 }}>Uptime: {service.uptime}</p>
            <p className="admDim" style={{ margin: '0.15rem 0' }}>Response: {service.response}</p>
            <small className="admDim">{service.incident}</small>
          </article>
        ))}
      </section>

      <section className="admCard" style={{ marginBottom: '0.8rem' }}>
        <div className="admSectionHeader"><h3>Server Performance</h3><span className="admBadgeStatus admGreen">Normal</span></div>
        <div className="admGaugeGrid">
          <div className="admGaugeCard"><div className="admGauge" style={{ '--gauge': '72%' }}><span>72%</span></div><p>CPU Usage</p></div>
          <div className="admGaugeCard"><div className="admGauge blue" style={{ '--gauge': '64%' }}><span>64%</span></div><p>Memory Usage</p></div>
          <div className="admGaugeCard"><div className="admGauge orange" style={{ '--gauge': '58%' }}><span>58%</span></div><p>Storage</p></div>
        </div>
      </section>

      <section className="admCard">
        <div className="admSectionHeader"><h3>Recent Incidents</h3></div>
        {incidents.map((item) => (
          <div key={item.service} className="admIncidentRow">
            <div><strong>{item.service}</strong><p className="admDim">{item.description}</p></div>
            <div className="admDim">{item.duration}</div>
            <div className="admDim">{item.resolved}</div>
            <span className={`admBadgeStatus ${item.status === 'Resolved' ? 'admGreen' : 'admRed'}`}>{item.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
