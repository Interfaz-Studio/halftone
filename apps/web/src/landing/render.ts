// Shared rendering for the presentation page: one offscreen engine paints every static figure
// (style cards, ramp rules) into ordinary 2D canvases, so the page holds a single WebGL context
// for them however many figures it shows. Canvases are redrawn when their size changes.
import { Halftone, diffusionKernel, type HalftoneParams } from '@interfaz/halftone';
import { toEngine } from '../app/state';
import { fullLook } from './looks';
import type { Look } from '../app/state';

let engine: Halftone | null = null;
const gl = () => (engine ??= new Halftone(new OffscreenCanvas(1, 1), {}, { preserveDrawingBuffer: true }));

export const supported = () => Halftone.isSupported();

export async function loadBitmap(src: string): Promise<ImageBitmap> {
  const blob = await (await fetch(src)).blob();
  return createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
}

/** Paint `source` screened with `look` into `canvas`, at the canvas' CSS size × dpr. */
export function paint(canvas: HTMLCanvasElement, source: TexImageSource, look: Partial<Look>, extra: Partial<HalftoneParams> = {}): void {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  const e = gl();
  e.resize(w, h);
  e.setOutputSize(null);
  e.setView({ scale: 1, x: 0, y: 0 });
  e.set({ ...toEngine(fullLook(look)), fit: 'cover', pixelRatio: dpr, ...extra });
  e.setSource(source);
  const job = e.diffusionJob();
  if (job) e.setDiffusionMask(diffusionKernel(job), job.gw, job.gh);
  e.render();
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(e.canvas, 0, 0);
}

/** Repaint whenever the canvas' size changes (debounced). */
export function keepPainted(canvas: HTMLCanvasElement, draw: () => void): void {
  let t = 0, last = '';
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (key === last) return;
    last = key;
    clearTimeout(t);
    t = window.setTimeout(draw, 80);
  }).observe(canvas);
}

/** A horizontal black → light-grey ramp, the source for the section rules. */
export function rampSource(): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 4 });
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  // stops short of white so a rule never ends in a solid block
  g.addColorStop(0, '#000'); g.addColorStop(1, '#9a9a9a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 4);
  return c;
}
