/**
 * WGS84 (EPSG:4326) → L-EST97 (EPSG:3301) for In-AKS gazetteer reverse.
 * Lambert Conformal Conic 2SP parameters from EPSG:3301.
 */

const A = 6378137.0
const F = 1 / 298.257222101
const E2 = 2 * F - F * F
const E = Math.sqrt(E2)
const LON0 = (24.0 * Math.PI) / 180
const LAT0 = (57.51755393055556 * Math.PI) / 180
const LAT1 = (59.33333333333334 * Math.PI) / 180
const LAT2 = (58.0 * Math.PI) / 180
const FALSE_E = 500_000.0
const FALSE_N = 6_375_000.0

function m(phi: number): number {
  return Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2)
}

function t(phi: number): number {
  const s = Math.sin(phi)
  return (
    Math.tan(Math.PI / 4 - phi / 2) /
    ((1 - E * s) / (1 + E * s)) ** (E / 2)
  )
}

const M1 = m(LAT1)
const M2 = m(LAT2)
const T0 = t(LAT0)
const T1 = t(LAT1)
const T2 = t(LAT2)
const N = (Math.log(M1) - Math.log(M2)) / (Math.log(T1) - Math.log(T2))
const FF = M1 / (N * T1 ** N)
const RHO0 = A * FF * T0 ** N

/** Returns { easting, northing } in metres (L-EST97). */
export function wgs84ToLest97(
  lon: number,
  lat: number,
): { easting: number; northing: number } {
  const lonR = (lon * Math.PI) / 180
  const latR = (lat * Math.PI) / 180
  const tp = t(latR)
  const rho = A * FF * tp ** N
  const theta = N * (lonR - LON0)
  return {
    easting: FALSE_E + rho * Math.sin(theta),
    northing: FALSE_N + RHO0 - rho * Math.cos(theta),
  }
}
