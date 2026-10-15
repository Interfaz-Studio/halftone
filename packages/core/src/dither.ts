/**
 * Dithering: the image as a grid of square "dither pixels", each fully inked or not.
 *
 * Ordered methods (Bayer, blue noise) compare each pixel's ink coverage with a tiled threshold
 * map — independent per pixel, so they run in the shader. Error diffusion (Floyd–Steinberg,
 * Atkinson) carries every pixel's rounding error to the pixels after it, so it is inherently
 * sequential: it runs on the CPU (in a worker when available) and the result is uploaded as a
 * mask. Both work on the same ink coverage the shader computes for dots.
 */

export const DITHER_METHODS = ['bayer2', 'bayer4', 'bayer8', 'blue', 'floyd', 'atkinson'] as const;
export type DitherMethod = (typeof DITHER_METHODS)[number];

export const isOrdered = (m: DitherMethod) => m !== 'floyd' && m !== 'atkinson';

/**
 * Bayer threshold map, n a power of two. Entry (x, y) = (rank + ½) / n², so coverage c inks
 * round(c · n²) of every n² pixels.
 */
export function bayer(n: number): Float32Array {
  let m = [0];
  for (let size = 1; size < n; size *= 2) {
    const next = new Array(size * 2 * size * 2);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = 4 * m[y * size + x]!;
      next[y * 2 * size + x] = v;
      next[y * 2 * size + x + size] = v + 2;
      next[(y + size) * 2 * size + x] = v + 3;
      next[(y + size) * 2 * size + x + size] = v + 1;
    }
    m = next;
  }
  return Float32Array.from(m, r => (r + 0.5) / (n * n));
}

/**
 * Blue-noise threshold map by void-and-cluster (Ulichney 1993): ranks are assigned so that the
 * pixels inked at any coverage are spread as evenly as possible, with no visible pattern.
 * Deterministic; ~50 ms for 64², so it's built once and cached.
 */
export function blueNoise(size = 64, sigma = 1.5): Float32Array {
  const n = size * size;
  // Gaussian energy kernel on a torus
  const kernel = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.min(x, size - x), dy = Math.min(y, size - y);
    kernel[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }
  const energy = new Float32Array(n);
  const ones = new Uint8Array(n);
  const splat = (p: number, sign: number) => {
    const px = p % size, py = (p / size) | 0;
    for (let y = 0; y < size; y++) {
      const ky = ((y - py + size) % size) * size;
      for (let x = 0; x < size; x++) energy[y * size + x]! += sign * kernel[ky + ((x - px + size) % size)]!;
    }
  };
  const extreme = (wantOne: number, pickMax: boolean) => {
    let best = -1, bestE = pickMax ? -Infinity : Infinity;
    for (let p = 0; p < n; p++) {
      if (ones[p] !== wantOne) continue;
      const e = energy[p]!;
      if (pickMax ? e > bestE : e < bestE) { bestE = e; best = p; }
    }
    return best;
  };

  // Initial pattern: ~10 % random points, relaxed until the tightest cluster is also the largest void
  let seed = 0x2545f491;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const initial = Math.round(n * 0.1);
  for (let placed = 0; placed < initial;) {
    const p = Math.floor(rand() * n);
    if (!ones[p]) { ones[p] = 1; splat(p, 1); placed++; }
  }
  for (let guard = 0; guard < n; guard++) {
    const cluster = extreme(1, true);
    ones[cluster] = 0; splat(cluster, -1);
    const voidP = extreme(0, false);
    if (voidP === cluster) { ones[cluster] = 1; splat(cluster, 1); break; }
    ones[voidP] = 1; splat(voidP, 1);
  }

  const rank = new Int32Array(n).fill(-1);
  const prototype = ones.slice(), protoEnergy = energy.slice();
  // Phase 1: remove the tightest clusters from the prototype → ranks below it
  for (let r = initial - 1; r >= 0; r--) {
    const p = extreme(1, true);
    ones[p] = 0; splat(p, -1); rank[p] = r;
  }
  // Phase 2: from the prototype, fill the largest voids → ranks above it
  ones.set(prototype); energy.set(protoEnergy);
  for (let r = initial; r < n; r++) {
    const p = extreme(0, false);
    ones[p] = 1; splat(p, 1); rank[p] = r;
  }
  return Float32Array.from(rank, r => (r + 0.5) / n);
}

/** Inputs the diffusion kernel needs; plain data so it can cross into a worker. */
export interface DiffusionJob {
  pixels: Uint8ClampedArray;   // source RGBA, sRGB, not premultiplied
  sw: number; sh: number;      // source size
  gw: number; gh: number;      // dither grid size (output size ÷ dither pixel)
  uvScale: [number, number]; uvOffset: [number, number];   // output → source uv, as in the shader
  clampEdges: boolean;
  tone: { brightness: number; contrast: number; gamma: number; invert: boolean; inkY: number; paperY: number; lightMin: number; lightMax: number };
  method: 'floyd' | 'atkinson';
}

/**
 * Coverage grid + error diffusion → mask (1 = ink), gw × gh.
 * Self-contained on purpose: it is stringified into a worker, so it must not reference anything
 * outside its own body. Its tone mapping mirrors `coverageAt` in shaders.ts (pinned by tests).
 */
export function diffusionKernel(job: DiffusionJob): Uint8Array {
  const { pixels, sw, sh, gw, gh, uvScale, uvOffset, clampEdges, tone, method } = job;
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const lightness = (y: number) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y) / 100;
  const toY = (l: number) => { const L = l * 100; return L > 8 ? Math.pow((L + 16) / 116, 3) : L / (24389 / 27); };
  const k = Math.min(0.999, Math.max(-0.999, tone.contrast));
  const kf = (1 + k) / (1 - k);
  const span = tone.inkY - tone.paperY;

  // 1. Ink coverage per dither pixel: average the source over the pixel's footprint in linear
  //    light (premultiplied), then run the same tone curve as the shader.
  const cov = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const u0 = (i / gw) * uvScale[0] + uvOffset[0], u1 = ((i + 1) / gw) * uvScale[0] + uvOffset[0];
      const v0 = (j / gh) * uvScale[1] + uvOffset[1], v1 = ((j + 1) / gh) * uvScale[1] + uvOffset[1];
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      if (!clampEdges && (uc < 0 || uc > 1 || vc < 0 || vc > 1)) continue;
      let x0 = Math.floor(Math.min(Math.max(u0, 0), 1) * sw), x1 = Math.ceil(Math.min(Math.max(u1, 0), 1) * sw);
      let y0 = Math.floor(Math.min(Math.max(v0, 0), 1) * sh), y1 = Math.ceil(Math.min(Math.max(v1, 0), 1) * sh);
      if (x1 <= x0) { x0 = Math.min(sw - 1, x0); x1 = x0 + 1; }
      if (y1 <= y0) { y0 = Math.min(sh - 1, y0); y1 = y0 + 1; }
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * sw + x) * 4, al = pixels[o + 3]! / 255;
        r += lin[pixels[o]!]! * al; g += lin[pixels[o + 1]!]! * al; b += lin[pixels[o + 2]!]! * al; a += al; n++;
      }
      if (a <= 0) continue;
      let l = lightness((0.2126 * r + 0.7152 * g + 0.0722 * b) / a);
      l += tone.brightness;
      l = (l - 0.5) * kf + 0.5;
      l = Math.pow(Math.min(1, Math.max(0, l)), 1 / tone.gamma);
      if (tone.invert) l = 1 - l;
      let c = Math.abs(span) < 1e-5 ? 1 - l : (toY(tone.lightMin + l * (tone.lightMax - tone.lightMin)) - tone.paperY) / span;
      c = Math.min(1, Math.max(0, c));
      cov[j * gw + i] = c * (a / n);
    }
  }

  // 2. Diffusion. Floyd–Steinberg scans serpentine (alternate rows reversed) to avoid diagonal
  //    worms; Atkinson spreads only ¾ of the error — its signature, crisp, slightly contrasty look.
  const mask = new Uint8Array(gw * gh);
  const add = (x: number, y: number, e: number) => { if (x >= 0 && x < gw && y < gh) cov[y * gw + x]! += e; };
  for (let y = 0; y < gh; y++) {
    const rev = method === 'floyd' && y % 2 === 1;
    for (let s = 0; s < gw; s++) {
      const x = rev ? gw - 1 - s : s, d = rev ? -1 : 1;
      const v = cov[y * gw + x]!;
      const out = v >= 0.5 ? 1 : 0;
      mask[y * gw + x] = out;
      const err = v - out;
      if (method === 'floyd') {
        // Weights of the neighbours that exist; renormalised so error at the image edges isn't
        // thrown away (that loss makes near-solid tones visibly off at the edges and overall)
        const ahead = x + d >= 0 && x + d < gw, behind = x - d >= 0 && x - d < gw, below = y + 1 < gh;
        const w1 = ahead ? 7 : 0, w2 = behind && below ? 3 : 0, w3 = below ? 5 : 0, w4 = ahead && below ? 1 : 0;
        const total = w1 + w2 + w3 + w4;
        if (total > 0) {
          const e = err / total;
          if (w1) add(x + d, y, e * w1);
          if (w2) add(x - d, y + 1, e * w2);
          if (w3) add(x, y + 1, e * w3);
          if (w4) add(x + d, y + 1, e * w4);
        }
      } else {
        const e = err / 8;
        add(x + 1, y, e); add(x + 2, y, e); add(x - 1, y + 1, e); add(x, y + 1, e); add(x + 1, y + 1, e); add(x, y + 2, e);
      }
    }
  }
  return mask;
}

/**
 * Runs `diffusionKernel` off the main thread. Requests are latest-wins: a newer job supersedes
 * one still running, so dragging a slider never queues up stale work. Falls back to running
 * inline where workers aren't available.
 */
export class DiffusionWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (mask: Uint8Array) => void>();

  run(job: DiffusionJob): Promise<Uint8Array | null> {
    const id = ++this.seq;
    // Drop older waiters: they'd only ever receive outdated results
    for (const [k, resolve] of this.pending) { if (k < id) { resolve(null as unknown as Uint8Array); this.pending.delete(k); } }
    const w = this.ensure();
    if (!w) return Promise.resolve(diffusionKernel(job));
    return new Promise(resolve => {
      this.pending.set(id, resolve as (m: Uint8Array) => void);
      w.postMessage({ id, job });
    });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach(r => r(null as unknown as Uint8Array));
    this.pending.clear();
  }

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
    try {
      const src = `const diffusionKernel = ${diffusionKernel.toString()};
self.onmessage = e => { const mask = diffusionKernel(e.data.job); self.postMessage({ id: e.data.id, mask }, [mask.buffer]); };`;
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = (e: MessageEvent<{ id: number; mask: Uint8Array }>) => {
        const resolve = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        resolve?.(e.data.mask);
      };
      return this.worker;
    } catch {
      return null;   // e.g. a CSP that forbids blob: workers
    }
  }
}
