import { Halftone, diffusionKernel, parseColor, type HalftoneParams } from '@interfaz/halftone';
import { lightnessRamp } from './patterns';
import { lightness, lightnessToY, srgbToLinear } from './srgb';

/**
 * Tone accuracy: screen an L* ramp and compare the average lightness of each strip of the output
 * against what the input lightness should map to between the two inks. Returns the worst error in L*.
 */
export function measureTone(params: Partial<HalftoneParams> = {}, width = 1600, height = 400, bins = 24) {
  const ramp = lightnessRamp(width, height);
  const off = new OffscreenCanvas(width, height);
  const m = new Halftone(off, { ...params, pixelRatio: 1, fit: 'fill', brightness: 0, contrast: 0, gamma: 1, invert: false }, { preserveDrawingBuffer: true });
  m.resize(width, height); m.setSource(ramp);
  const job = m.diffusionJob();
  if (job) m.setDiffusionMask(diffusionKernel(job), job.gw, job.gh);
  m.render();
  const ctx = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d')!;
  ctx.drawImage(off, 0, 0);
  const px = ctx.getImageData(0, 0, width, height).data;
  const lum = (r: number, g: number, b: number) => 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
  const ylum = (css: string) => { const [r, g, b] = parseColor(css); return lum(r * 255, g * 255, b * 255); };
  const yi = ylum(m.params.ink), yp = ylum(m.params.paper);
  const lo = lightness(Math.min(yi, yp)), hi = lightness(Math.max(yi, yp));
  m.destroy();

  const rows: string[] = []; let worst = 0;
  const bw = width / bins, margin = 24;   // skip the image border
  for (let b = 1; b < bins - 1; b++) {
    let sum = 0, n = 0;
    for (let y = margin; y < height - margin; y++) for (let x = Math.round(b * bw); x < Math.round((b + 1) * bw); x++) {
      const i = (y * width + x) * 4; sum += lum(px[i]!, px[i + 1]!, px[i + 2]!); n++;
    }
    const got = lightness(sum / n) * 100;
    // Expected: average the target luminance over the strip's columns (not the lightness at its
    // centre) — L* is non-linear, so that's what the eye-averaged output should match
    let ySum = 0; const x0 = Math.round(b * bw), x1 = Math.round((b + 1) * bw);
    for (let x = x0; x < x1; x++) ySum += lightnessToY(lo + (x / (width - 1)) * (hi - lo));
    const want = lightness(ySum / (x1 - x0)) * 100;
    const input = ((b + 0.5) * bw) / (width - 1);
    worst = Math.max(worst, Math.abs(got - want));
    rows.push(`${(input * 100).toFixed(0).padStart(3)} → want ${want.toFixed(1)} got ${got.toFixed(1)}`);
  }
  return { worst, rows };
}

