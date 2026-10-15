import { DiffusionWorker } from './dither.js';
import { Halftone, type HalftoneParams } from './halftone.js';

export interface ExportOptions {
  /** Output pixels per source pixel (default 1). Cells scale with it, so the result looks the same, sharper. */
  scale?: number;
  /** MIME type passed to the encoder (default `image/png`). */
  type?: string;
}

/**
 * Render a halftone of `source` at full resolution and encode it.
 * The output is `source size × scale`; `params.cell` is measured in source pixels.
 * Uses an OffscreenCanvas when available, so it never touches the page.
 */
export async function exportImage(source: TexImageSource, params: Partial<HalftoneParams> = {}, options: ExportOptions = {}): Promise<Blob> {
  const scale = options.scale ?? 1;
  if (!(scale > 0)) throw new RangeError('scale must be > 0');
  const { width, height } = source as { width: number; height: number };
  const sw = (source as HTMLImageElement).naturalWidth || (source as HTMLVideoElement).videoWidth || width;
  const sh = (source as HTMLImageElement).naturalHeight || (source as HTMLVideoElement).videoHeight || height;
  const w = Math.round(sw * scale), h = Math.round(sh * scale);

  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });

  const ht = new Halftone(canvas, { ...params, pixelRatio: scale, fit: 'fill' }, { preserveDrawingBuffer: true });
  try {
    ht.resize(w, h);
    ht.setSource(source);
    // Error diffusion is computed on the CPU first (in a worker when available)
    if (ht.diffusionJob()) {
      const worker = new DiffusionWorker();
      try { await ht.updateDiffusion(job => worker.run(job)); } finally { worker.destroy(); }
    }
    ht.render();
    const type = options.type ?? 'image/png';
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type });
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Encoding failed'))), type));
  } finally {
    ht.destroy();
  }
}
