import { describe, expect, it } from 'vitest';
import { adjustLightness } from '../src/tone';

const neutral = { brightness: 0, contrast: 0, gamma: 1, invert: false };

describe('adjustLightness', () => {
  it('is the identity with neutral settings', () => {
    for (let l = 0; l <= 1; l += 0.05) expect(adjustLightness(l, neutral)).toBeCloseTo(l, 12);
  });
  it('inverts', () => {
    expect(adjustLightness(0.2, { ...neutral, invert: true })).toBeCloseTo(0.8, 12);
  });
  it('contrast pivots around mid grey and clips', () => {
    const p = { ...neutral, contrast: 0.5 };
    expect(adjustLightness(0.5, p)).toBeCloseTo(0.5, 12);
    expect(adjustLightness(0.6, p)).toBeCloseTo(0.8, 12);   // factor (1 + .5) / (1 − .5) = 3
    expect(adjustLightness(0.9, p)).toBe(1);
  });
  it('gamma above 1 lifts the midtones but keeps the end points', () => {
    const p = { ...neutral, gamma: 2 };
    expect(adjustLightness(0, p)).toBe(0);
    expect(adjustLightness(1, p)).toBe(1);
    expect(adjustLightness(0.25, p)).toBeCloseTo(0.5, 12);
  });
});
