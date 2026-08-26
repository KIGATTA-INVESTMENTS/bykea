/**
 * Ingo Kilometres — prepaid distance credit rates (wallet pay only).
 * Bike: $3.00 for first 3km, then $0.60/km.
 * Tuktuk: $5.00 for first 3km, then $0.60/km.
 */

export const INGO_KM_RATE = 0.6;
export const INGO_INCLUDED_KM = 3;
export const INGO_BIKE_MIN_FARE = 3;
export const INGO_TUKTUK_MIN_FARE = 5;

/** Top-up packs at face $0.60/km. */
export const INGO_KM_TOPUP_PACKAGES = [
  { id: '50km', km: 50, amount: 30, label: '50 Ingo Kilometres' },
  { id: '100km', km: 100, amount: 60, label: '100 Ingo Kilometres' },
  { id: '500km', km: 500, amount: 300, label: '500 Ingo Kilometres' },
];

export const INGO_SUPPORT_PHONE = '0789 701 394';

/**
 * @param {number} balanceUsd
 * @returns {number} approximate km remaining at $0.60/km
 */
export function approxKmFromBalance(balanceUsd) {
  const bal = Number(balanceUsd);
  if (!Number.isFinite(bal) || bal <= 0) return 0;
  return Math.round((bal / INGO_KM_RATE) * 10) / 10;
}

/**
 * @param {'bike'|'tuktuk'|string|null|undefined} vehicle
 * @returns {'bike'|'tuktuk'|null}
 */
export function normalizeIngoVehicle(vehicle) {
  const v = String(vehicle || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (v === 'bike' || v === 'bicycle' || v === 'motorbike' || v === 'motorcycle') return 'bike';
  if (v === 'tuktuk' || v === 'tuk' || v === 'tuktukride') return 'tuktuk';
  return null;
}

/**
 * Ride booking vehicle id → Ingo vehicle (null if not eligible).
 * @param {string} rideId
 * @param {boolean} [isTukOnly]
 */
export function resolveIngoVehicleFromRide(rideId, isTukOnly = false) {
  if (isTukOnly) return 'tuktuk';
  return normalizeIngoVehicle(rideId);
}

/**
 * Parcel delivery package vehicle → Ingo vehicle (null if not eligible).
 * @param {Record<string, unknown>} [navState]
 */
export function resolveIngoVehicleFromDelivery(navState) {
  const v = String(navState?.package?.requestedVehicleType ?? '').trim();
  if (v === 'Tuk-Tuk') return 'tuktuk';
  if (v === 'Motorbike' || v === 'Bicycle' || v === 'Bike') return 'bike';
  return null;
}

/**
 * @param {{ vehicle: 'bike'|'tuktuk'|string, distanceKm: number }} params
 * @returns {{
 *   fare: number,
 *   billableKm: number,
 *   vehicle: 'bike'|'tuktuk',
 *   minFare: number,
 *   includedKm: number,
 *   extraKm: number,
 *   extraFare: number,
 *   ratePerKm: number,
 *   breakdown: { minFare: number, extraKm: number, extraFare: number, total: number },
 * } | null}
 */
export function computeIngoKilometreFare({ vehicle, distanceKm }) {
  const v = normalizeIngoVehicle(vehicle);
  if (!v) return null;
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) return null;

  const billableKm = Math.round(km * 1000) / 1000;
  const minFare = v === 'tuktuk' ? INGO_TUKTUK_MIN_FARE : INGO_BIKE_MIN_FARE;
  const extraKm = Math.max(0, billableKm - INGO_INCLUDED_KM);
  const extraFare = Math.round(extraKm * INGO_KM_RATE * 100) / 100;
  const fare =
    billableKm <= INGO_INCLUDED_KM
      ? minFare
      : Math.round((minFare + extraFare) * 100) / 100;

  return {
    fare,
    billableKm,
    vehicle: v,
    minFare,
    includedKm: INGO_INCLUDED_KM,
    extraKm: Math.round(extraKm * 1000) / 1000,
    extraFare,
    ratePerKm: INGO_KM_RATE,
    breakdown: {
      minFare,
      extraKm: Math.round(extraKm * 1000) / 1000,
      extraFare,
      total: fare,
    },
  };
}
