import type { Station } from "@/lib/types";
import { haversineKm } from "@/lib/haversine";

/**
 * Area-ratio (drainage-area scaling) transfer of flood quantiles to an
 * ungauged site:  Q_site = Q_donor × (A_site / A_donor)^n
 *
 * The exponent n is typically 0.6–0.9 for Canadian basins; 0.75 is a common
 * default when no regional study is available.
 */

export const DEFAULT_TRANSFER_EXPONENT = 0.75;

/** Validity guidance: the method degrades quickly outside this area ratio. */
export const AREA_RATIO_VALID_MIN = 0.2;
export const AREA_RATIO_VALID_MAX = 5;

export function transferScaleFactor(
  aSiteKm2: number, aDonorKm2: number, exponent: number
): number {
  return Math.pow(aSiteKm2 / aDonorKm2, exponent);
}

export interface NearbyStation {
  station: Station;
  distanceKm: number;
}

/**
 * Candidate donor stations near a point, sorted by distance.
 * Only stations with a known gross drainage area qualify as donors.
 */
export function findNearbyDonors(
  catalog: Station[],
  lat: number,
  lon: number,
  excludeId: string,
  count = 8
): NearbyStation[] {
  return catalog
    .filter(
      (s) =>
        s.station_number !== excludeId &&
        s.drainage_area_gross_km2 !== null &&
        s.drainage_area_gross_km2 > 0
    )
    .map((s) => ({
      station: s,
      distanceKm: haversineKm(lat, lon, s.latitude, s.longitude),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}
