/** Shop owner payout destination: bank transfer or mobile money. */

export const PAYOUT_METHOD_BANK = 'bank';
export const PAYOUT_METHOD_MOBILE = 'mobile_money';

export const MOBILE_MONEY_PROVIDERS = [
  { id: 'ecocash', label: 'EcoCash' },
  { id: 'onemoney', label: 'OneMoney' },
  { id: 'innbucks', label: 'InnBucks' },
];

export function mobileMoneyProviderLabel(id) {
  const hit = MOBILE_MONEY_PROVIDERS.find((p) => p.id === String(id || '').toLowerCase());
  return hit?.label || String(id || '').trim() || '—';
}

export function payoutMethodLabel(method) {
  const m = String(method || '').toLowerCase();
  if (m === PAYOUT_METHOD_MOBILE) return 'Mobile money';
  if (m === PAYOUT_METHOD_BANK) return 'Bank';
  return '—';
}

/**
 * Normalize form values into DB columns.
 * @param {{
 *   payoutMethod?: string,
 *   mobileProvider?: string,
 *   bankName?: string,
 *   bankAccountName?: string,
 *   bankAccountNumber?: string,
 *   bankBranch?: string,
 *   mobilePhone?: string,
 *   mobileAccountName?: string,
 * }} form
 */
export function buildShopOwnerPayoutPayload(form) {
  const method = String(form.payoutMethod || PAYOUT_METHOD_BANK).toLowerCase();
  if (method === PAYOUT_METHOD_MOBILE) {
    const provider = String(form.mobileProvider || '').toLowerCase().trim();
    const phone = String(form.mobilePhone || '').trim();
    const name = String(form.mobileAccountName || '').trim();
    return {
      payout_method: PAYOUT_METHOD_MOBILE,
      mobile_money_provider: provider || null,
      mobile_money_phone: phone || null,
      mobile_money_account_name: name || null,
      bank_name: null,
      bank_account_name: name || null,
      bank_account_number: phone || null,
      bank_branch: null,
    };
  }
  return {
    payout_method: PAYOUT_METHOD_BANK,
    mobile_money_provider: null,
    mobile_money_phone: null,
    mobile_money_account_name: null,
    bank_name: String(form.bankName || '').trim() || null,
    bank_account_name: String(form.bankAccountName || '').trim() || null,
    bank_account_number: String(form.bankAccountNumber || '').trim() || null,
    bank_branch: String(form.bankBranch || '').trim() || null,
  };
}

/**
 * Validate payout fields before save.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateShopOwnerPayoutForm(form) {
  const method = String(form.payoutMethod || '').toLowerCase();
  if (method === PAYOUT_METHOD_MOBILE) {
    if (!MOBILE_MONEY_PROVIDERS.some((p) => p.id === String(form.mobileProvider || '').toLowerCase())) {
      return { ok: false, error: 'Choose a mobile money provider (EcoCash, OneMoney, or InnBucks).' };
    }
    if (!String(form.mobileAccountName || '').trim()) {
      return { ok: false, error: 'Enter the name as it appears on the mobile money account.' };
    }
    const phone = String(form.mobilePhone || '').trim();
    if (phone.replace(/\D/g, '').length < 7) {
      return { ok: false, error: 'Enter a valid mobile money phone number.' };
    }
    return { ok: true };
  }
  if (method === PAYOUT_METHOD_BANK) {
    if (!String(form.bankName || '').trim()) {
      return { ok: false, error: 'Enter the bank name.' };
    }
    if (!String(form.bankAccountName || '').trim()) {
      return { ok: false, error: 'Enter the account holder name.' };
    }
    if (!String(form.bankAccountNumber || '').trim()) {
      return { ok: false, error: 'Enter the bank account number.' };
    }
    return { ok: true };
  }
  return { ok: false, error: 'Choose Bank or Mobile money for payouts.' };
}

/** Map a shop_owners row to UI payout form fields. */
export function payoutFormFromShopOwnerRow(row) {
  const method = String(row?.payout_method || '').toLowerCase();
  if (method === PAYOUT_METHOD_MOBILE || (!method && row?.mobile_money_provider)) {
    return {
      payoutMethod: PAYOUT_METHOD_MOBILE,
      mobileProvider: row.mobile_money_provider || 'ecocash',
      mobilePhone: row.mobile_money_phone || row.bank_account_number || '',
      mobileAccountName: row.mobile_money_account_name || row.bank_account_name || '',
      bankName: '',
      bankAccountName: '',
      bankAccountNumber: '',
      bankBranch: '',
    };
  }
  return {
    payoutMethod: PAYOUT_METHOD_BANK,
    mobileProvider: 'ecocash',
    mobilePhone: '',
    mobileAccountName: '',
    bankName: row?.bank_name || '',
    bankAccountName: row?.bank_account_name || '',
    bankAccountNumber: row?.bank_account_number || '',
    bankBranch: row?.bank_branch || '',
  };
}

/** Human-readable summary for admin / payments display. */
export function formatShopOwnerPayoutSummary(row) {
  const method = String(row?.payout_method || '').toLowerCase();
  if (method === PAYOUT_METHOD_MOBILE || row?.mobile_money_provider) {
    return {
      method: 'Mobile money',
      provider: mobileMoneyProviderLabel(row.mobile_money_provider),
      accountName: row.mobile_money_account_name || row.bank_account_name || '—',
      phone: row.mobile_money_phone || row.bank_account_number || '—',
      bankName: null,
      accountNumber: null,
      branch: null,
    };
  }
  if (row?.bank_name || row?.bank_account_number || row?.bank_account_name) {
    return {
      method: 'Bank',
      provider: null,
      accountName: row.bank_account_name || '—',
      phone: null,
      bankName: row.bank_name || '—',
      accountNumber: row.bank_account_number || '—',
      branch: row.bank_branch || '—',
    };
  }
  return null;
}
