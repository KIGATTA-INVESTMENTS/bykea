import { fetchActiveOrdersForDriver, fetchCompletedDeliveriesForDriver } from './driverIncomingBookings';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export const ACCOUNT_MODE_SOLO = 'solo';
export const ACCOUNT_MODE_COMPANY_OWNER = 'company_owner';
export const ACCOUNT_MODE_COMPANY_BIKER = 'company_biker';

/** @param {unknown} mode */
export function isCompanyOwnerMode(mode) {
  return String(mode || '').toLowerCase() === ACCOUNT_MODE_COMPANY_OWNER;
}

/**
 * Create empty fleet bike draft for the register form.
 * @param {number} [index]
 */
export function emptyFleetBikeDraft(index = 0) {
  return {
    key: `bike-${Date.now()}-${index}`,
    bikerName: '',
    bikerPhone: '',
    bikerEmail: '',
    bikerPassword: '',
    vehicleType: 'Motorbike',
    vMake: '',
    vModel: '',
    vPlate: '',
    vColor: '',
  };
}

function isValidBikerEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @param {typeof emptyFleetBikeDraft extends () => infer T ? T : never} bike
 * @param {number} index
 * @param {{ emailsSeen?: Set<string> }} [opts]
 */
export function validateFleetBikeDraft(bike, index, opts = {}) {
  const n = index + 1;
  if (!String(bike.bikerName || '').trim()) return `Bike ${n}: enter the biker's name.`;
  if (!String(bike.bikerPhone || '').trim() || String(bike.bikerPhone).replace(/\D/g, '').length < 7) {
    return `Bike ${n}: enter a valid biker phone number.`;
  }
  const email = String(bike.bikerEmail || '').trim().toLowerCase();
  if (!email || !isValidBikerEmail(email)) {
    return `Bike ${n}: enter the biker's own login email (they will sign in with this).`;
  }
  if (opts.emailsSeen) {
    if (opts.emailsSeen.has(email)) return `Bike ${n}: this login email is already used on another bike.`;
    opts.emailsSeen.add(email);
  }
  if (!String(bike.bikerPassword || '').trim() || String(bike.bikerPassword).length < 6) {
    return `Bike ${n}: set a login password for the biker (at least 6 characters).`;
  }
  if (!String(bike.vMake || '').trim() || !String(bike.vModel || '').trim()) {
    return `Bike ${n}: enter vehicle make and model.`;
  }
  if (!String(bike.vPlate || '').trim()) return `Bike ${n}: enter the number plate.`;
  if (!String(bike.vColor || '').trim()) return `Bike ${n}: enter vehicle colour.`;
  return null;
}

/**
 * Validate a list of fleet bikes; each must have a unique email + password.
 * @param {ReturnType<typeof emptyFleetBikeDraft>[]} bikes
 */
export function validateFleetBikesList(bikes) {
  if (!bikes?.length) return 'Add at least one bike and biker.';
  const emailsSeen = new Set();
  for (let i = 0; i < bikes.length; i += 1) {
    const v = validateFleetBikeDraft(bikes[i], i, { emailsSeen });
    if (v) return v;
  }
  return null;
}

/**
 * Load company owned by this driver (as owner).
 * @param {string} ownerDriverId
 */
export async function fetchCompanyForOwner(ownerDriverId) {
  if (!isSupabaseConfigured || !supabase || !ownerDriverId) return null;
  const { data, error } = await supabase
    .from('driver_companies')
    .select('*')
    .eq('owner_driver_id', ownerDriverId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * @param {string} companyId
 */
export async function fetchCompanyFleetBikes(companyId) {
  if (!isSupabaseConfigured || !supabase || !companyId) return [];
  const { data, error } = await supabase
    .from('company_fleet_bikes')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

/**
 * Company dashboard snapshot: bikes + active jobs + completed earnings.
 * @param {string} companyId
 * @param {{ commissionPercent?: number }} [opts]
 */
export async function fetchCompanyFleetDashboard(companyId, opts = {}) {
  const bikes = await fetchCompanyFleetBikes(companyId);
  const driverIds = [...new Set(bikes.map((b) => b.driver_id).filter(Boolean))];

  const activeByDriver = {};
  const completedByDriver = {};
  await Promise.all(
    driverIds.map(async (id) => {
      const [active, completed] = await Promise.all([
        fetchActiveOrdersForDriver(supabase, id).catch(() => []),
        fetchCompletedDeliveriesForDriver(supabase, id),
      ]);
      activeByDriver[id] = Array.isArray(active) ? active : [];
      completedByDriver[id] = Array.isArray(completed) ? completed : [];
    }),
  );

  const commissionPct = Number(opts.commissionPercent);
  const rate = Number.isFinite(commissionPct) ? commissionPct / 100 : 0.15;

  const bikeRows = bikes.map((b) => {
    const active = activeByDriver[b.driver_id] || [];
    const completed = completedByDriver[b.driver_id] || [];
    const gross = completed.reduce((s, j) => s + (Number(j.amount) || 0), 0);
    const net = Math.round(gross * (1 - rate) * 100) / 100;
    return {
      ...b,
      activeJobs: active,
      completedCount: completed.length,
      grossEarned: Math.round(gross * 100) / 100,
      netEarned: net,
      recentJobs: completed.slice(0, 5),
    };
  });

  const activeJobs = bikeRows.flatMap((b) =>
    (b.activeJobs || []).map((j) => ({
      ...j,
      bikeId: b.id,
      bikerName: b.biker_name,
      plate: b.vehicle_plate,
    })),
  );
  const allCompleted = bikeRows.flatMap((b) =>
    (b.recentJobs || []).map((j) => ({
      ...j,
      bikeId: b.id,
      bikerName: b.biker_name,
      plate: b.vehicle_plate,
    })),
  );
  const totalGross = bikeRows.reduce((s, b) => s + b.grossEarned, 0);
  const totalNet = bikeRows.reduce((s, b) => s + b.netEarned, 0);
  const totalCompleted = bikeRows.reduce((s, b) => s + b.completedCount, 0);

  return {
    bikes: bikeRows,
    activeJobs,
    recentCompleted: allCompleted
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 20),
    totals: {
      bikeCount: bikes.length,
      activeCount: activeJobs.length,
      completedCount: totalCompleted,
      gross: Math.round(totalGross * 100) / 100,
      net: Math.round(totalNet * 100) / 100,
    },
  };
}

/**
 * Register company owner + company + fleet bikes (each bike gets a pending biker login).
 * @param {{
 *   ownerPayload: Record<string, unknown>,
 *   companyName: string,
 *   tradingName?: string,
 *   fleetBikes: ReturnType<typeof emptyFleetBikeDraft>[],
 *   phoneCountryCode: string,
 * }} opts
 */
export async function registerCompanyOwnerWithFleet(opts) {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Service unavailable.' };
  }
  const { ownerPayload, companyName, tradingName, fleetBikes, phoneCountryCode } = opts;
  if (!String(companyName || '').trim()) {
    return { ok: false, error: 'Enter your delivery company name.' };
  }
  const fleetErr = validateFleetBikesList(fleetBikes);
  if (fleetErr) return { ok: false, error: fleetErr };

  const first = fleetBikes[0];
  const ownerRow = {
    ...ownerPayload,
    account_mode: ACCOUNT_MODE_COMPANY_OWNER,
    vehicle_type: first.vehicleType || 'Motorbike',
    vehicle_make: first.vMake.trim() || 'Fleet',
    vehicle_model: first.vModel.trim() || 'Owner',
    vehicle_plate: `CO-${String(first.vPlate || 'OWNER')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 10)
      .toUpperCase()}`,
    vehicle_color: first.vColor.trim() || 'N/A',
  };

  let { data: owner, error: oErr } = await supabase
    .from('driver_registrations')
    .insert(ownerRow)
    .select('id, email, full_name, phone')
    .single();

  if (oErr && /account_mode|company_id|column/i.test(oErr.message || '')) {
    const { account_mode: _am, company_id: _cid, ...slim } = ownerRow;
    ({ data: owner, error: oErr } = await supabase
      .from('driver_registrations')
      .insert(slim)
      .select('id, email, full_name, phone')
      .single());
    if (!oErr) {
      return {
        ok: false,
        error: 'Owner saved, but run supabase/driver_companies_fleet.sql then re-add fleet bikes from Fleet.',
        ownerId: owner?.id,
      };
    }
  }
  if (oErr) {
    return { ok: false, error: oErr.message || 'Could not register company owner.', code: oErr.code };
  }

  const { data: company, error: cErr } = await supabase
    .from('driver_companies')
    .insert({
      owner_driver_id: owner.id,
      company_name: companyName.trim(),
      trading_name: String(tradingName || '').trim() || null,
      phone: owner.phone || null,
      email: owner.email || null,
      status: 'pending',
    })
    .select('id, company_name')
    .single();

  if (cErr) {
    return {
      ok: false,
      error: `${cErr.message || 'Could not create company.'} Run supabase/driver_companies_fleet.sql if tables are missing.`,
      ownerId: owner.id,
    };
  }

  await supabase
    .from('driver_registrations')
    .update({ company_id: company.id, account_mode: ACCOUNT_MODE_COMPANY_OWNER })
    .eq('id', owner.id);

  const createdBikes = [];
  for (const bike of fleetBikes) {
    const result = await addCompanyFleetBike({
      companyId: company.id,
      ownerEmail: owner.email,
      companySlug: company.company_name,
      bike,
      phoneCountryCode,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || 'Company created but a bike failed to save.',
        ownerId: owner.id,
        companyId: company.id,
        partialBikes: createdBikes,
      };
    }
    createdBikes.push(result);
  }

  return {
    ok: true,
    ownerId: owner.id,
    companyId: company.id,
    bikes: createdBikes,
  };
}

/**
 * Add a bike (+ optional biker login) to an existing company.
 * @param {{
 *   companyId: string,
 *   ownerEmail: string,
 *   companySlug: string,
 *   bike: ReturnType<typeof emptyFleetBikeDraft>,
 *   phoneCountryCode?: string,
 * }} opts
 */
export async function addCompanyFleetBike(opts) {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Service unavailable.' };
  }
  const { companyId, bike, phoneCountryCode = '+263' } = opts;
  const err = validateFleetBikeDraft(bike, 0);
  if (err) return { ok: false, error: err };

  const plate = bike.vPlate.trim().toUpperCase();
  const email = String(bike.bikerEmail || '').trim().toLowerCase();
  if (!email || !isValidBikerEmail(email)) {
    return { ok: false, error: "Enter the biker's own login email." };
  }

  const { data: existing } = await supabase
    .from('driver_registrations')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing?.id) {
    return { ok: false, error: `Email ${email} is already registered. Each biker needs their own unique email.` };
  }

  const nationalId = `FLEET-${plate}-${Date.now().toString(36).slice(-6)}`.slice(0, 40);

  const { data: driver, error: dErr } = await supabase
    .from('driver_registrations')
    .insert({
      full_name: bike.bikerName.trim(),
      phone: bike.bikerPhone.trim(),
      email,
      national_id: nationalId,
      password: String(bike.bikerPassword),
      phone_country_code: phoneCountryCode,
      vehicle_type: bike.vehicleType || 'Motorbike',
      vehicle_make: bike.vMake.trim(),
      vehicle_model: bike.vModel.trim(),
      vehicle_plate: plate,
      vehicle_color: bike.vColor.trim(),
      deposit_required_gbp: 10,
      account_mode: ACCOUNT_MODE_COMPANY_BIKER,
      company_id: companyId,
      email_verified_at: new Date().toISOString(),
      status: 'pending',
    })
    .select('id, email, full_name, status')
    .single();

  if (dErr) {
    return { ok: false, error: dErr.message || 'Could not create biker account.' };
  }

  const { data: fleet, error: fErr } = await supabase
    .from('company_fleet_bikes')
    .insert({
      company_id: companyId,
      driver_id: driver.id,
      biker_name: bike.bikerName.trim(),
      biker_phone: bike.bikerPhone.trim(),
      biker_email: email,
      vehicle_type: bike.vehicleType || 'Motorbike',
      vehicle_make: bike.vMake.trim(),
      vehicle_model: bike.vModel.trim(),
      vehicle_plate: plate,
      vehicle_color: bike.vColor.trim(),
      status: 'active',
    })
    .select('*')
    .single();

  if (fErr) {
    return { ok: false, error: fErr.message || 'Biker created but fleet bike row failed.' };
  }

  return { ok: true, driver, bike: fleet };
}
