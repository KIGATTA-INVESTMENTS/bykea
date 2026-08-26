/** Product categories for shop owner add/edit forms (broader than grocery-only). */
export const PRODUCT_CATEGORIES = [
  // Grocery & food
  'Dairy',
  'Bakery',
  'Produce',
  'Farm Produce',
  'Pantry',
  'Beverages',
  'Snacks',
  'Frozen',
  'Meat & Seafood',
  'Ready meals',
  // Restaurants / takeaway
  'Meals',
  'Breakfast',
  'Lunch',
  'Dinner',
  'Sides',
  'Desserts',
  'Drinks',
  // Beauty
  'Hair care',
  'Skin care',
  'Makeup',
  'Fragrance',
  'Personal care',
  // Fashion
  'Clothing',
  'Shoes',
  'Bags',
  'Accessories',
  'Fashion',
  // Electronics & tools
  'Electronics',
  'Phones & accessories',
  'Computers',
  'Home appliances',
  'Tools',
  'Car parts',
  // Health & pharmacy
  'Pharmacy',
  'Vitamins & supplements',
  'First aid',
  // Home & office
  'Household',
  'Cleaning',
  'Office and stationery',
  'Books',
  // Liquor
  'Beer',
  'Wine',
  'Spirits',
  'Liquor',
  // Catch-all
  'Other',
];

const SUGGESTED_TAGS_BY_CATEGORY = {
  Dairy: ['milk', 'cheese', 'yogurt', 'butter', 'fresh'],
  Bakery: ['bread', 'cakes', 'pastry', 'fresh'],
  Produce: ['fruit', 'vegetables', 'fresh', 'organic'],
  'Farm Produce': ['farm', 'fresh', 'local', 'organic'],
  Pantry: ['staple', 'cooking', 'dry goods'],
  Beverages: ['drink', 'juice', 'water', 'soft drink'],
  Snacks: ['chips', 'sweets', 'snack'],
  Frozen: ['frozen', 'ice cream'],
  'Meat & Seafood': ['meat', 'chicken', 'fish', 'fresh'],
  'Ready meals': ['ready to eat', 'convenient'],
  Meals: ['meal', 'hot food', 'takeaway'],
  Breakfast: ['breakfast', 'morning'],
  Lunch: ['lunch', 'midday'],
  Dinner: ['dinner', 'evening'],
  Sides: ['side', 'extra'],
  Desserts: ['dessert', 'sweet', 'cake'],
  Drinks: ['drink', 'cold', 'hot'],
  'Hair care': ['hair', 'shampoo', 'conditioner', 'beauty'],
  'Skin care': ['skin', 'moisturiser', 'beauty'],
  Makeup: ['makeup', 'cosmetics', 'beauty'],
  Fragrance: ['perfume', 'scent', 'beauty'],
  'Personal care': ['hygiene', 'toiletries'],
  Clothing: ['clothes', 'apparel', 'wear'],
  Shoes: ['shoes', 'footwear'],
  Bags: ['bag', 'handbag'],
  Accessories: ['accessory', 'fashion'],
  Fashion: ['fashion', 'style', 'trend'],
  Electronics: ['gadget', 'tech', 'electronic'],
  'Phones & accessories': ['phone', 'charger', 'case'],
  Computers: ['laptop', 'computer', 'tech'],
  'Home appliances': ['appliance', 'home'],
  Tools: ['tool', 'hardware', 'DIY'],
  'Car parts': ['car', 'auto', 'spare'],
  Pharmacy: ['medicine', 'health', 'pharmacy'],
  'Vitamins & supplements': ['vitamin', 'health', 'supplement'],
  'First aid': ['first aid', 'health'],
  Household: ['home', 'household'],
  Cleaning: ['clean', 'soap', 'detergent'],
  'Office and stationery': ['office', 'stationery', 'paper'],
  Books: ['book', 'read'],
  Beer: ['beer', 'alcohol'],
  Wine: ['wine', 'alcohol'],
  Spirits: ['spirits', 'alcohol'],
  Liquor: ['alcohol', 'liquor'],
  Other: ['popular', 'new'],
};

const MAX_TAGS = 12;
const MAX_TAG_LEN = 32;

/** @param {unknown} value */
export function normalizeProductCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Other';
  const hit = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return hit || raw.slice(0, 48);
}

/**
 * @param {unknown} input string, string[], or jsonb-ish
 * @returns {string[]}
 */
export function normalizeProductTags(input) {
  let list = [];
  if (Array.isArray(input)) list = input;
  else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) list = [];
    else if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        list = trimmed.split(/[,;]+/);
      }
    } else {
      list = trimmed.split(/[,;]+/);
    }
  }

  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** @param {string} category */
export function suggestedTagsForCategory(category) {
  const key = normalizeProductCategory(category);
  return SUGGESTED_TAGS_BY_CATEGORY[key] || SUGGESTED_TAGS_BY_CATEGORY.Other;
}

/**
 * @param {{ name?: string, category?: string, description?: string, shopName?: string, brandName?: string, tags?: string[] }} product
 * @param {string} query
 */
export function productMatchesSearch(product, query) {
  const t = String(query || '')
    .trim()
    .toLowerCase();
  if (!t) return true;
  const tags = normalizeProductTags(product?.tags);
  const hay = [
    product?.name,
    product?.category,
    product?.description,
    product?.shopName,
    product?.brandName,
    tags.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(t);
}
