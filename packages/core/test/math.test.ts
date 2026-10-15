import { describe, expect, it } from 'vitest';
import { FULL_RADIUS, buildRadiusLut, circleCoverage, circleRadius } from '../src/coverage';
import { lightness, lightnessToLuminance, linearToSrgb, parseColor, srgbToLinear } from '../src/color';

describe('circleCoverage', () => {
  it('hits the known reference points', () => {
    expect(circleCoverage(0)).toBe(0);
    expect(circleCoverage(0.5)).toBeCloseTo(Math.PI / 4, 12);   // dot just touches its cell edges
    expect(circleCoverage(FULL_RADIUS)).toBe(1);                 // corners covered
    expect(circleCoverage(1)).toBe(1);
  });

  it('is continuous where the dot starts to spill over the cell edges', () => {
    expect(circleCoverage(0.5 + 1e-9)).toBeCloseTo(circleCoverage(0.5 - 1e-9), 6);
  });

  it('is strictly increasing', () => {
    let prev = -1;
    for (let r = 0; r <= FULL_RADIUS; r += 1e-4) {
      const c = circleCoverage(r);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('matches a Monte-Carlo estimate of the union of dots on a lattice', () => {
    // Independent check: sample points in one cell and test them against the 3×3 neighbouring dots
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const r of [0.2, 0.45, 0.55, 0.65, 0.7]) {
      let hit = 0; const N = 200_000;
      for (let i = 0; i < N; i++) {
        const x = rand() - 0.5, y = rand() - 0.5;
        let inside = false;
        for (let dx = -1; dx <= 1 && !inside; dx++) for (let dy = -1; dy <= 1; dy++) {
          if ((x - dx) ** 2 + (y - dy) ** 2 <= r * r) { inside = true; break; }
        }
        if (inside) hit++;
      }
      expect(Math.abs(hit / N - circleCoverage(r))).toBeLessThan(0.004);
    }
  });
});

describe('circleRadius', () => {
  it('inverts circleCoverage across the whole range', () => {
    for (let c = 0; c <= 1; c += 0.001) {
      expect(circleCoverage(circleRadius(c))).toBeCloseTo(c, 9);
    }
  });

  it('clamps outside [0, 1]', () => {
    expect(circleRadius(-1)).toBe(0);
    expect(circleRadius(2)).toBe(FULL_RADIUS);
  });
});

describe('buildRadiusLut', () => {
  it('reproduces coverage within 0.1% when linearly interpolated, as the shader does', () => {
    const lut = buildRadiusLut(1024);
    const n = lut.length - 1;
    let worst = 0;
    for (let c = 0; c <= 1; c += 1e-4) {
      const x = c * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
      const r = lut[i]! * (1 - f) + lut[i + 1]! * f;
      worst = Math.max(worst, Math.abs(circleCoverage(r) - c));
    }
    expect(worst).toBeLessThan(0.001);
  });
});

describe('colour', () => {
  it('parses the supported notations', () => {
    expect(parseColor('#CA3430')).toEqual([202 / 255, 52 / 255, 48 / 255, 1]);
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseColor('#ff000080')[3]).toBeCloseTo(128 / 255, 6);
    expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgba(0 0 0 / 50%)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
  });

  it('rejects invalid input instead of guessing', () => {
    for (const bad of ['', 'red', '#12', '#ggg', 'rgb(1,2)', 'rgb(a,b,c)']) {
      expect(() => parseColor(bad)).toThrow();
    }
  });

  it('round-trips the sRGB and L* transfer functions', () => {
    for (let v = 0; v <= 1; v += 0.01) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 10);
      expect(lightnessToLuminance(lightness(v))).toBeCloseTo(v, 10);
    }
    expect(lightness(1)).toBeCloseTo(1, 12);
    expect(lightness(0.18)).toBeCloseTo(0.4950, 3);   // middle grey ≈ L* 49.5
  });
});
