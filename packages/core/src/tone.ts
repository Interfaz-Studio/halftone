import type { HalftoneParams } from './halftone.js';

/**
 * The tone adjustments the shader applies to a source lightness (CIE L* scaled to 0–1),
 * mirrored on the CPU so UIs can show the result (histograms, clipping) without reading the GPU.
 * Keep in sync with `coverageAt` in shaders.ts — test/tone.test.ts pins the formula.
 */
export function adjustLightness(l: number, p: Pick<HalftoneParams, 'brightness' | 'contrast' | 'gamma' | 'invert'>): number {
  let v = l + p.brightness;
  const k = Math.min(0.999, Math.max(-0.999, p.contrast));
  v = (v - 0.5) * ((1 + k) / (1 - k)) + 0.5;
  v = Math.pow(Math.min(1, Math.max(0, v)), 1 / p.gamma);
  return p.invert ? 1 - v : v;
}
