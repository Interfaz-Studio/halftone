// The README's code samples, type-checked (`npm run typecheck`). Not executed: they need a GPU.
// Keep in sync with README.md.
import { DiffusionWorker, Halftone, exportImage } from '../src/index';

export async function rendering(canvas: HTMLCanvasElement) {
  const ht = new Halftone(canvas, { cell: 6, ink: '#111111', paper: '#F2EFE8' });
  const img = new Image();
  img.src = '/photo.jpg';
  await img.decode();
  ht.setSource(img);
  function draw() {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio;
    ht.resize(r.width * dpr, r.height * dpr);
    ht.set({ pixelRatio: dpr });
    ht.render();
  }
  new ResizeObserver(draw).observe(canvas);
  ht.set({ angle: 15, shape: 'line' });
  ht.render();
  ht.destroy();
}

export async function exporting(image: HTMLImageElement) {
  const png = await exportImage(image, { shape: 'euclidean', cell: 6 }, { scale: 2 });
  return URL.createObjectURL(png);
}

export async function diffusion(ht: Halftone) {
  const worker = new DiffusionWorker();
  ht.set({ mode: 'dither', dither: 'floyd', pixel: 2 });
  ht.render();
  await ht.updateDiffusion(job => worker.run(job));
  ht.render();
}

export function zoom(ht: Halftone, img: HTMLImageElement) {
  ht.setOutputSize({ width: img.naturalWidth, height: img.naturalHeight });
  ht.set({ fit: 'fill' });
  ht.setView({ scale: 2, x: 400, y: 300 });
  ht.render();
}
