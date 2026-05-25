/** In-app default: USD */
export const DEFAULT_CURRENCY = 'USD';

const LOCALE = 'en-US';

export function formatUSD(value) {
  const n = Number(value);
  if (value == null || Number.isNaN(n)) {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY }).format(0);
  }
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY }).format(n);
}

/** @deprecated Use formatUSD — kept for existing imports */
export const formatGBP = formatUSD;

export const FMT_USD = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY });

/** @deprecated Use FMT_USD — kept for existing imports */
export const FMT_GBP = FMT_USD;
