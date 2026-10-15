import { describe, expect, it } from 'vitest';
import { SHAPES, buildThresholdLut, spot, spotSlope, type Shape } from '../src/shapes';

const spotShapes = SHAPES.filter(s => s !== 'round') as Shape[];

/** Exact area {spot < t} for the shapes with a closed form (t in the 0–1 edge-normalised units). */
const exact: Partial<Record<Shape, (t: number) => number>> = {
  square: t => t * t,
  line: t => t,
  cross: t => 1 - (1 - t) ** 2,
  diamond: t => (t <= 1 ? (t * t) / 2 : 1 - ((2 - t) ** 2) / 2),
};

/** Share of the cell whose spot value is below t: exact where known, else a fine grid. */
function area(shape: Shape, t: number, ratio = 1, grid = 400) {
  const f = exact[shape];
  if (f) return f(Math.min(Math.max(t, 0), shape === 'diamond' ? 2 : 1));
  let n = 0;
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
    if (spot(shape, (i + 0.5) / grid - 0.5, (j + 0.5) / grid - 0.5, ratio) < t) n++;
  }
  return n / (grid * grid);
}

describe('threshold tables', () => {
  for (const shape of spotShapes) {
    it(`${shape}: threshold for coverage c inks c of the cell`, () => {
      const lut = buildThresholdLut(shape, 0.6);
      for (const c of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const t = lut[Math.round(c * (lut.length - 1))]!;
        expect(Math.abs(area(shape, t, 0.6) - c)).toBeLessThan(0.004);   // independent, finer grid
      }
    });
    it(`${shape}: thresholds never decrease`, () => {
      const lut = buildThresholdLut(shape, 0.6);
      for (let i = 1; i < lut.length; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
    });
  }
});

describe('euclidean', () => {
  it('is a checkerboard at 50 %: the threshold sits on the diamond x + y = ½', () => {
    const lut = buildThresholdLut('euclidean');
    const t = lut[Math.round(0.5 * (lut.length - 1))]!;
    // Every point inside the diamond is below it, every point outside above it
    expect(spot('euclidean', 0.2, 0.2)).toBeLessThan(t);
    expect(spot('euclidean', 0.3, 0.3)).toBeGreaterThan(t);
  });
  it('inks the centre first and the corners last', () => {
    expect(spot('euclidean', 0, 0)).toBeLessThan(spot('euclidean', 0.1, 0.1));
    expect(spot('euclidean', 0.5, 0.5)).toBeGreaterThan(spot('euclidean', 0.4, 0.45));
  });
});

describe('spotSlope', () => {
  // Analytic slope must match a numerical one wherever the function is smooth
  for (const shape of spotShapes) {
    it(`${shape}: matches finite differences`, () => {
      const h = 1e-5;
      for (const [x, y] of [[0.11, 0.07], [0.31, 0.12], [0.2, 0.41], [0.43, 0.38], [0.05, 0.33]] as const) {
        const gx = (spot(shape, x + h, y, 0.6) - spot(shape, x - h, y, 0.6)) / (2 * h);
        const gy = (spot(shape, x, y + h, 0.6) - spot(shape, x, y - h, 0.6)) / (2 * h);
        expect(spotSlope(shape, x, y, 0.6)).toBeCloseTo(Math.hypot(gx, gy), 3);
      }
    });
  }
});
