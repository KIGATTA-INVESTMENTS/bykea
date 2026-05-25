export const CATEGORIES = ['All', 'Groceries', 'Pharmacy', 'Electronics', 'Food', 'Clothing'];

export const MOCK_SHOPS = [
  {
    id: 's1',
    name: "Fresh Mart",
    category: 'Groceries',
    rating: 4.6,
    delivery: '20â€“30 min',
    fee: 'Â$0.99',
    imageUrl:
      'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=640&q=80',
  },
  {
    id: 's2',
    name: "MediCare Plus",
    category: 'Pharmacy',
    rating: 4.8,
    delivery: '15â€“25 min',
    fee: 'Free over Â$20',
    imageUrl:
      'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 's3',
    name: "Tech World",
    category: 'Electronics',
    rating: 4.4,
    delivery: '25â€“40 min',
    fee: 'Â$1.50',
    imageUrl:
      'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=640&q=80',
  },
  {
    id: 's4',
    name: "Spice Kitchen",
    category: 'Food',
    rating: 4.7,
    delivery: '18â€“30 min',
    fee: 'Â$0.00',
    imageUrl:
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=640&q=80',
  },
];

/** Flat product list: shop + category for filtering */
export const MOCK_PRODUCTS = [
  {
    id: 'p1',
    shopId: 's1',
    shopName: 'Fresh Mart',
    name: 'Organic Milk 1L',
    price: 2.4,
    category: 'Groceries',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p2',
    shopId: 's1',
    shopName: 'Fresh Mart',
    name: 'Farm Eggs (12)',
    price: 3.1,
    category: 'Groceries',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3e8b?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p3',
    shopId: 's2',
    shopName: 'MediCare Plus',
    name: 'Vitamin C 30ct',
    price: 8.5,
    category: 'Pharmacy',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1550572017-edd28885888d?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p4',
    shopId: 's2',
    shopName: 'MediCare Plus',
    name: 'Plaster pack',
    price: 1.2,
    category: 'Pharmacy',
    inStock: false,
    imageUrl: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p5',
    shopId: 's3',
    shopName: 'Tech World',
    name: 'USB-C cable',
    price: 6.99,
    category: 'Electronics',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1583863788444-92a641b67f47?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p6',
    shopId: 's3',
    shopName: 'Tech World',
    name: 'Earbuds T500',
    price: 24,
    category: 'Electronics',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p7',
    shopId: 's4',
    shopName: 'Spice Kitchen',
    name: 'Biryani plate',
    price: 5.5,
    category: 'Food',
    inStock: true,
    imageUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Chicken_biryani.jpg/960px-Chicken_biryani.jpg',
  },
  {
    id: 'p8',
    shopId: 's4',
    shopName: 'Spice Kitchen',
    name: 'Mint Chutney',
    price: 0.9,
    category: 'Food',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p9',
    shopId: 's1',
    shopName: 'Fresh Mart',
    name: 'Cotton T-shirt M',
    price: 12,
    category: 'Clothing',
    inStock: true,
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 'p10',
    shopId: 's3',
    shopName: 'Tech World',
    name: 'T-shirt (promo)',
    price: 0,
    category: 'Clothing',
    inStock: false,
    imageUrl: 'https://images.unsplash.com/photo-1503341504253-dff4815485de?auto=format&fit=crop&w=400&q=80',
  },
];

export function getShopById(shopId) {
  if (!shopId) return null;
  return MOCK_SHOPS.find((s) => s.id === shopId) || null;
}

export function getProductsByShop(shopId) {
  if (!shopId) return [];
  return MOCK_PRODUCTS.filter((p) => p.shopId === shopId);
}

export function groupByCategory(products) {
  const m = new Map();
  for (const p of products) {
    const c = p.category;
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(p);
  }
  return Array.from(m.entries());
}
