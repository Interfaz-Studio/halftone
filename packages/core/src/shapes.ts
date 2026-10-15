/**
 * Dot shapes as spot functions — the way PostScript screens are defined.
 *
 * A spot function gives every point of a cell an order value: as ink coverage rises, points
 * are inked from the lowest value up. Coverage c inks exactly the points whose value is below
 * the c-quantile of the function over the cell, so the threshold for each coverage is read
 * from a table built by sampling the function (`buildThresholdLut`). That keeps every shape
 * tone-accurate without a hand-derived area formula.
 *
 * Cell-local coordinates: (x, y) ∈ [−½, ½]², dot centre at the origin. The shader mirrors
 * `spot` and `spotSlope` exactly — test/shapes.test.ts pins the formulas.
 *
 * `round` is not a spot shape: it is drawn as a union of circles across neighbouring cells
 * (see coverage.ts), which keeps dots round past the point where they touch.
 */

export const SHAPES = ['round', 'euclidean', 'square', 'diamond', 'ellipse', 'line', 'cross'] as const;
export type Shape = (typeof SHAPES)[number];

/** Integer ids shared with the shader. */
export const SHAPE_ID: Record<Shape, number> = { round: 0, euclidean: 1, square: 2, diamond: 3, ellipse: 4, line: 5, cross: 6 };

/** Order value at (x, y). `ratio` (0–1] only affects `ellipse`: the dot's height / width. */
export function spot(shape: Shape, x: number, y: number, ratio = 1): number {
  const ax = Math.abs(x) * 2, ay = Math.abs(y) * 2;   // [0, 1] from centre to edge
  switch (shape) {
    case 'euclidean':
      // Grows as a round dot, meets its neighbours as a checkerboard at 50 %, then shrinks the
      // paper to round holes at the corners — the classic photographic dot.
      return ax + ay <= 1 ? ax * ax + ay * ay - 1 : 1 - ((1 - ax) * (1 - ax) + (1 - ay) * (1 - ay));
    case 'square': return Math.max(ax, ay);
    case 'diamond': return ax + ay;
    case 'ellipse': return Math.hypot(ax, ay / ratio);
    case 'line': return ay;
    case 'cross': return Math.min(ax, ay);
    case 'round': return Math.hypot(ax, ay);
  }
}

/**
 * |∇spot| in cell units, analytic per region. Used to turn a threshold distance into a pixel
 * distance for antialiasing; a numerical gradient would explode across the Euclidean seam.
 */
export function spotSlope(shape: Shape, x: number, y: number, ratio = 1): number {
  const ax = Math.abs(x) * 2, ay = Math.abs(y) * 2;
  switch (shape) {
    case 'euclidean':
      return ax + ay <= 1 ? 4 * Math.hypot(ax, ay) : 4 * Math.hypot(1 - ax, 1 - ay);
    case 'square': case 'line': case 'cross': return 2;
    case 'diamond': return 2 * Math.SQRT2;
    case 'ellipse': {
      const s = Math.hypot(ax, ay / ratio);
      return s > 0 ? (2 * Math.hypot(ax, ay / (ratio * ratio))) / s : 2;
    }
    case 'round': return 2;
  }
}

/**
 * Threshold table: entry i is the spot value below which a fraction i / (size − 1) of the cell
 * lies. Built from a jittered `grid`² sample of the cell: one random point per grid square, so
 * shapes with flat runs (line, square, cross) don't produce long ties that would make coverage
 * jump a whole row at a time. Deterministic, so tables are identical everywhere.
 */
export function buildThresholdLut(shape: Shape, ratio = 1, size = 1024, grid = 256): Float32Array {
  const n = grid * grid;
  const values = new Float32Array(n);
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let j = 0, k = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      values[k++] = spot(shape, (i + rand()) / grid - 0.5, (j + rand()) / grid - 0.5, ratio);
    }
  }
  values.sort();
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    // Threshold between the last inked sample and the next: exactly round(c·n) samples are below it
    const k = Math.round((i / (size - 1)) * n);
    const lo = k > 0 ? values[k - 1]! : values[0]! - 1;
    const hi = k < n ? values[k]! : values[n - 1]! + 1;
    lut[i] = (lo + hi) / 2;
  }
  return lut;
}
