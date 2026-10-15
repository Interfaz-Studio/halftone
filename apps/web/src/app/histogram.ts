// Tone histogram for the inspector: the source's lightness after the current tone adjustments,
// with the share of pixels clipped to pure paper / solid ink at either end.
import { adjustLightness, lightness, luminance, srgbToLinear } from '@interfaz/halftone';
import { h } from './controls';
import type { Look } from './state';

const BINS = 64;
const SAMPLE = 256;   // the source is downsampled to at most this many px per side

export class Histogram {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private lowLabel: HTMLElement;
  private highLabel: HTMLElement;
  private base: Float32Array = new Float32Array(0);   // source lightness per sample, 0–1

  constructor() {
    this.canvas = h('canvas', { class: 'histo-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.lowLabel = h('span');
    this.highLabel = h('span');
    this.el = h('figure', { class: 'histo' }, this.canvas, h('figcaption', { class: 'histo-legend' }, this.lowLabel, this.highLabel));
  }

  setSource(src: ImageBitmap | null): void {
    if (!src) { this.base = new Float32Array(0); return; }
    const k = Math.min(1, SAMPLE / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k)), hgt = Math.max(1, Math.round(src.height * k));
    const ctx = new OffscreenCanvas(w, hgt).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, hgt);
    const d = ctx.getImageData(0, 0, w, hgt).data;
    const lut = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 8) continue;   // ignore transparent pixels
      out.push(lightness(luminance(lut[d[i]!]!, lut[d[i + 1]!]!, lut[d[i + 2]!]!)));
    }
    this.base = Float32Array.from(out);
  }

  draw(look: Look): void {
    const dpr = devicePixelRatio;
    const cssW = this.canvas.clientWidth || 240, cssH = this.canvas.clientHeight || 48;
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.base.length) { this.lowLabel.textContent = ''; this.highLabel.textContent = ''; return; }

    const bins = new Uint32Array(BINS);
    let low = 0, high = 0;
    for (const l of this.base) {
      const v = adjustLightness(l, look);
      if (v <= 0.002) low++; else if (v >= 0.998) high++;
      bins[Math.min(BINS - 1, Math.floor(v * BINS))]!++;
    }
    // Scale by the second-largest bin so a single spike (e.g. a white background) doesn't flatten the rest
    const sorted = [...bins].sort((a, b) => b - a);
    const peak = Math.max(1, sorted[1] ?? sorted[0] ?? 1);
    const W = this.canvas.width, H = this.canvas.height, bw = W / BINS;
    const styles = getComputedStyle(this.el);
    ctx.fillStyle = styles.getPropertyValue('--histo-bar').trim() || '#555';
    for (let i = 0; i < BINS; i++) {
      const bh = Math.min(1, bins[i]! / peak) * H;
      ctx.fillRect(Math.floor(i * bw), H - bh, Math.ceil(bw) - 1, bh);
    }

    const pct = (n: number) => (n / this.base.length) * 100;
    const fmt = (n: number) => (n < 0.1 ? '0' : n < 10 ? n.toFixed(1) : n.toFixed(0));
    // Clipped = flattened to pure black / pure white after the adjustments: detail lost there
    this.lowLabel.textContent = `Black ${fmt(pct(low))}%`;
    this.highLabel.textContent = `White ${fmt(pct(high))}%`;
    this.lowLabel.title = this.highLabel.title = 'Share of the image clipped to the end of the tone range';
    this.lowLabel.classList.toggle('is-warn', pct(low) > 5);
    this.highLabel.classList.toggle('is-warn', pct(high) > 5);
  }
}
