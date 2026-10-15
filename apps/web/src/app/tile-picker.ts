// A radio group of preview tiles, each a live render by the engine in the current colours.
// Used for dot shapes and dither methods so both behave identically (keyboard, captions, redraws).
import { Halftone, diffusionKernel, type HalftoneParams } from '@interfaz/halftone';
import { h, type Control } from './controls';
import { impliedPaper, type Look, type Store } from './state';

export interface TileItem<T> { value: T; name: string; note: string }

interface TilePickerOpts<T> {
  label: string;
  items: TileItem<T>[];
  get(): T;
  set(v: T): void;
  /** Engine params that make the tile for `value` (colours are added from the look). */
  tileParams(value: T): Partial<HalftoneParams>;
}

export const TILE_W = 52, TILE_H = 34;   // css px

// One offscreen renderer for every tile in the app, and the dark→light ramp they all show
let renderer: Halftone | null = null;
let ramp: HTMLCanvasElement | null = null;
function tileRenderer(w: number, h: number): Halftone {
  if (!ramp) {
    ramp = Object.assign(document.createElement('canvas'), { width: 96, height: 8 });
    const ctx = ramp.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 96, 0);
    grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 96, 8);
  }
  renderer ??= new Halftone(new OffscreenCanvas(w, h), {}, { preserveDrawingBuffer: true });
  renderer.resize(w, h);
  renderer.setSource(ramp);
  return renderer;
}

export function tilePicker<T>(store: Store, o: TilePickerOpts<T>): Control {
  const dpr = Math.min(2, devicePixelRatio);
  const caption = h('p', { class: 'tile-note' });
  const tiles = o.items.map(item => {
    const canvas = h('canvas', { width: String(TILE_W * dpr), height: String(TILE_H * dpr), 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const btn = h('button', { type: 'button', class: 'tile', role: 'radio', title: item.name, 'aria-label': item.name }, canvas) as HTMLButtonElement;
    btn.addEventListener('click', () => o.set(item.value));
    return { item, btn, canvas };
  });
  const group = h('div', { class: 'tile-grid', role: 'radiogroup', 'aria-label': o.label }, ...tiles.map(t => t.btn));
  const el = h('div', { class: 'tile-picker' }, group, caption);

  group.addEventListener('keydown', e => {
    const dir = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!dir) return;
    e.preventDefault();
    const i = o.items.findIndex(it => it.value === o.get());
    const next = o.items[(i + dir + o.items.length) % o.items.length]!;
    o.set(next.value);
    tiles.find(t => t.item.value === next.value)!.btn.focus();
  });

  let drawnKey = '';
  const draw = (look: Look) => {
    const key = `${look.ink}|${look.paper}|${look.transparent}`;
    if (key === drawnKey) return;
    drawnKey = key;
    const r = tileRenderer(TILE_W * dpr, TILE_H * dpr);
    for (const t of tiles) {
      r.set({
        fit: 'fill', pixelRatio: dpr, angle: 45, cell: 7, quality: 6,
        ink: look.ink, paper: look.transparent ? impliedPaper(look.ink) : look.paper, transparent: look.transparent,
        ...o.tileParams(t.item.value),
      });
      const job = r.diffusionJob();
      if (job) r.setDiffusionMask(diffusionKernel(job), job.gw, job.gh);
      r.render();
      const ctx = t.canvas.getContext('2d')!;
      ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
      ctx.drawImage(r.canvas, 0, 0);
    }
  };

  const update = () => {
    const current = o.get();
    for (const t of tiles) {
      const on = t.item.value === current;
      t.btn.setAttribute('aria-checked', String(on));
      t.btn.tabIndex = on ? 0 : -1;
    }
    const it = o.items.find(i => i.value === current) ?? o.items[0]!;
    caption.replaceChildren(h('strong', {}, it.name), ` — ${it.note}`);
    draw(store.look);
  };
  update();
  return { el, update };
}
