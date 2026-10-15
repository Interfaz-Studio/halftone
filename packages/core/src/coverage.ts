/**
 * Dot geometry for an amplitude-modulated (AM) screen of round dots on a square lattice.
 *
 * Work in cell units: dots sit on integer lattice points, one dot per 1×1 cell.
 * A dot of radius r covers `circleCoverage(r)` of the plane:
 *  - r ≤ ½      the dot fits inside its cell → πr²
 *  - ½ < r < √½ the dot spills over the cell edges. Inside a cell no neighbour is ever closer
 *               than the cell's own centre, so only the dot clipped to its own cell counts:
 *               πr² minus the four circular segments beyond the edges
 *  - r ≥ √½     the corners are covered too → 1 (solid ink)
 *
 * The shader needs the inverse — "this much ink → this radius" — which has no closed form,
 * so it is tabulated once (`buildRadiusLut`) and interpolated on the GPU.
 */

/** Radius at which round dots on a unit lattice cover the plane completely. */
export const FULL_RADIUS = Math.SQRT1_2;

/** Area of the circular segment of a radius-`r` circle beyond a chord at distance `d` from its centre. */
function segment(r: number, d: number): number {
  if (r <= d) return 0;
  return r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
}

/** Fraction of the plane covered by round dots of radius `r` (cell units) on a unit lattice. */
export function circleCoverage(r: number): number {
  if (r <= 0) return 0;
  if (r >= FULL_RADIUS) return 1;
  const area = Math.PI * r * r - 4 * segment(r, 0.5);
  return Math.min(1, Math.max(0, area));
}

/** Inverse of `circleCoverage`: the dot radius (cell units) that gives coverage `c` ∈ [0, 1]. */
export function circleRadius(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return FULL_RADIUS;
  // Exact while the dot still fits in its cell
  if (c <= Math.PI / 4) return Math.sqrt(c / Math.PI);
  // Otherwise bisect — coverage is strictly increasing on (½, √½); 50 halvings reach double precision
  let lo = 0.5, hi = FULL_RADIUS;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (circleCoverage(mid) < c) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Radius lookup table: entry i holds `circleRadius(i / (size - 1))`.
 * Sampled with linear interpolation on the GPU; 1024 entries keep the coverage error below 0.1%
 * (the worst case is next to solid ink, where the radius curve is steepest).
 */
export function buildRadiusLut(size = 1024): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = circleRadius(i / (size - 1));
  return lut;
}
