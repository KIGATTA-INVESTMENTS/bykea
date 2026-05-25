export const MOCK_ORDERS = [
  {
    id: 'ING-00234',
    status: 'delivered',
    from: 'Green Valley Mart, Stratford, London E15',
    to: '22 Bloomsbury Way, London WC1A',
    date: '12 Apr 2025, 2:10 PM',
    price: 'Â$2.50',
    rated: false,
    driver: { name: 'Zain Ahmed', phone: '+44 7700 900101', vehicle: 'Honda 125', plate: 'AB19 CDE' },
    breakdown: { base: 1.5, distance: 0.8, service: 0.2, total: 2.5 },
  },
  {
    id: 'ING-00188',
    status: 'transit',
    from: 'Camden High Street, London NW1',
    to: 'Kings Cross Station, London N1C',
    date: '12 Apr 2025, 1:00 PM',
    price: 'Â$3.20',
    rated: false,
    driver: { name: 'Bilal Khan', phone: '+44 7700 900102', vehicle: 'Suzuki 150', plate: 'LM20 FGH' },
    breakdown: { base: 1.5, distance: 1.2, service: 0.5, total: 3.2 },
  },
  {
    id: 'ING-00100',
    status: 'active',
    from: 'Canary Wharf, London E14',
    to: 'Liverpool Street, London EC2',
    date: '11 Apr 2025, 4:30 PM',
    price: 'Â$1.80',
    rated: false,
    driver: { name: 'Hassan Ali', phone: '+44 7700 900103', vehicle: 'Honda 125', plate: 'YN68 JKL' },
    breakdown: { base: 1, distance: 0.5, service: 0.3, total: 1.8 },
  },
  {
    id: 'ING-00055',
    status: 'cancelled',
    from: 'Notting Hill Gate, London W11',
    to: 'Paddington Station, London W2',
    date: '10 Apr 2025, 9:00 AM',
    price: 'Â$0.00',
    rated: true,
    driver: null,
    breakdown: { base: 0, distance: 0, service: 0, total: 0 },
  },
];

export function getOrderById(id) {
  if (id == null) return null;
  const dec = String(id).replace(/^#/, '');
  return MOCK_ORDERS.find((o) => o.id === dec) || null;
}

export function filterOrders(orders, filter) {
  if (filter === 'all') return orders;
  if (filter === 'active') return orders.filter((o) => o.status === 'active' || o.status === 'transit');
  if (filter === 'delivered') return orders.filter((o) => o.status === 'delivered');
  if (filter === 'cancelled') return orders.filter((o) => o.status === 'cancelled');
  return orders;
}

export function statusLabel(s) {
  if (s === 'delivered') return 'Delivered';
  if (s === 'transit') return 'In Transit';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'active') return 'Active';
  return s;
}
