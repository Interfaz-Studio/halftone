import { describe, expect, it } from 'vitest';
import { bayer, blueNoise, diffusionKernel, type DiffusionJob } from '../src/dither';
import { adjustLightness } from '../src/tone';
import { lightness, lightnessToLuminance, luminance, srgbToLinear } from '../src/color';

const isPermutation = (t: Float32Array) => {
  const n = t.length;
  const ranks = [...t].map(v => Math.round(v * n - 0.5)).sort((a, b) => a - b);
  return ranks.every((r, i) => r === i);
};

describe('bayer', () => {
  it('matches the classic 2×2 and 4×4 matrices', () => {
    expect([...bayer(2)].map(v => v * 4 - 0.5)).toEqual([0, 2, 3, 1]);
    expect([...bayer(4)].map(v => v * 16 - 0.5)).toEqual([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  });
  it('is a permutation of all ranks at every size', () => {
    for (const n of [2, 4, 8]) expect(isPermutation(bayer(n))).toBe(true);
  });
});

describe('blueNoise', () => {
  const map = blueNoise(32);
  it('is a permutation of all ranks', () => expect(isPermutation(map)).toBe(true));
  it('spreads the first pixels evenly (no two of the first 5 % are neighbours)', () => {
    const size = 32, first = [...map].map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).slice(0, Math.round(map.length * 0.05)).map(x => x[1]);
    const set = new Set(first);
    for (const p of first) {
      const x = p % size, y = (p / size) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
        expect(set.has(((y + dy + size) % size) * size + ((x + dx + size) % size))).toBe(false);
      }
    }
  });
});

/** A job over a flat grey source with black ink on white paper. */
function flatJob(grey: number, method: 'floyd' | 'atkinson', size = 64): DiffusionJob {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) pixels.set([grey, grey, grey, 255], i * 4);
  return {
    pixels, sw: size, sh: size, gw: size, gh: size, uvScale: [1, 1], uvOffset: [0, 0], clampEdges: true, method,
    tone: { brightness: 0, contrast: 0, gamma: 1, invert: false, inkY: 0, paperY: 1, lightMin: 0, lightMax: 1 },
  };
}

describe('diffusionKernel', () => {
  it('Floyd–Steinberg reproduces flat tones exactly on average', () => {
    for (const grey of [32, 96, 128, 200, 240]) {
      const mask = diffusionKernel(flatJob(grey, 'floyd'));
      const ink = mask.reduce((s, v) => s + v, 0) / mask.length;
      // black ink on white: coverage = 1 − luminance of the grey (tone curve is identity for b/w)
      const want = 1 - srgbToLinear(grey / 255);
      expect(Math.abs(ink - want)).toBeLessThan(0.01);
    }
  });

  it('Atkinson keeps mid-tones but loses near-solid tones, by design', () => {
    const ink = (grey: number) => { const m = diffusionKernel(flatJob(grey, 'atkinson')); return m.reduce((s, v) => s + v, 0) / m.length; };
    // grey 188 ≈ 50 % ink in linear light: exact
    expect(Math.abs(ink(188) - (1 - srgbToLinear(188 / 255)))).toBeLessThan(0.02);
    // grey 128 ≈ 78 % ink: Atkinson only passes on ¾ of the error, so dark tones fill in to solid
    expect(ink(128)).toBeGreaterThan(1 - srgbToLinear(128 / 255));
  });

  it('uses the same tone curve as the shader', () => {
    // One-pixel job: the coverage decision for a mid grey must flip exactly where the curve says
    const tone = { brightness: 0.1, contrast: 0.2, gamma: 1.3, invert: false, inkY: 0.02, paperY: 0.9, lightMin: lightness(0.02), lightMax: lightness(0.9) };
    for (const grey of [60, 120, 180]) {
      const l = lightness(luminance(srgbToLinear(grey / 255), srgbToLinear(grey / 255), srgbToLinear(grey / 255)));
      const adj = adjustLightness(l, { brightness: 0.1, contrast: 0.2, gamma: 1.3, invert: false });
      const y = lightnessToLuminance(tone.lightMin + adj * (tone.lightMax - tone.lightMin));
      const c = Math.min(1, Math.max(0, (y - tone.paperY) / (tone.inkY - tone.paperY)));
      const job = { ...flatJob(grey, 'floyd', 128), tone };
      const mask = diffusionKernel(job);
      expect(Math.abs(mask.reduce((s, v) => s + v, 0) / mask.length - c)).toBeLessThan(0.01);
    }
  });

  it('averages a dither pixel over its whole footprint (4×4 source px per dither px)', () => {
    // Half black, half white columns inside every 4×4 block → 50 % coverage everywhere
    const sw = 64, pixels = new Uint8ClampedArray(sw * sw * 4);
    for (let y = 0; y < sw; y++) for (let x = 0; x < sw; x++) { const v = x % 4 < 2 ? 0 : 255; pixels.set([v, v, v, 255], (y * sw + x) * 4); }
    const mask = diffusionKernel({ ...flatJob(0, 'floyd'), pixels, gw: 16, gh: 16 });
    expect(Math.abs(mask.reduce((s, v) => s + v, 0) / mask.length - 0.5)).toBeLessThan(0.02);
  });
});
