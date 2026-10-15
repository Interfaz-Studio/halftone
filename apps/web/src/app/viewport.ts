// The canvas area: zoom, pan and compare-with-original. Ink-only looks render straight onto the
// workspace background (no checkerboard).
// Zoom is in device pixels: 100% shows one image pixel per screen pixel — the only scale at which
// dots can be judged honestly — so on a retina display 100% looks half the CSS size.
import { DiffusionWorker, Halftone } from '@interfaz/halftone';
import { h } from './controls';
import { toEngine, type Store } from './state';

export const ZOOM_STEPS = [0.05, 0.1, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MIN_ZOOM = ZOOM_STEPS[0]!, MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
const FIT_MARGIN = 48;   // css px around the image when fitted
const PREVIEW_QUALITY = 4;   // antialiasing while interacting; settled frames use the export quality

// Identity for a source bitmap (a new image must trigger a new diffusion even with equal settings)
const ids = new WeakMap<object, number>();
let nextId = 0;
const docId = (o: object) => { let id = ids.get(o); if (id === undefined) ids.set(o, (id = ++nextId)); return id; };

export class Viewport {
  readonly el: HTMLElement;
  readonly engine: Halftone;
  private canvas: HTMLCanvasElement;
  private compare: HTMLCanvasElement;
  private zoom = 1;          // canvas px per image px
  private x = 0; private y = 0;   // image px at the canvas' top-left
  private fitted = true;     // keep refitting on resize until the user zooms or pans
  private comparing = false;
  private frame = 0;
  private dpr = devicePixelRatio;
  private listeners = new Set<() => void>();
  // Error diffusion runs in a worker; the key says which settings the current mask was made for
  private worker = new DiffusionWorker();
  private diffusionKey = '';
  private diffusionTimer = 0;
  diffusing = false;

  constructor(private store: Store) {
    this.canvas = h('canvas', { class: 'vp-canvas', 'aria-label': 'Halftone preview' }) as HTMLCanvasElement;
    this.compare = h('canvas', { class: 'vp-compare', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.el = h('div', { class: 'vp' }, this.canvas, this.compare);
    this.engine = new Halftone(this.canvas);

    new ResizeObserver(() => this.layout()).observe(this.el);
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { this.dpr = devicePixelRatio; this.layout(); });
    this.bindInput();
    store.subscribe(why => { if (why === 'look') this.request(); });
  }

  /** Called when zoom or position change (the toolbar and status bar listen). */
  onChange(fn: () => void) { this.listeners.add(fn); }
  get zoomLevel() { return this.zoom; }

  // ── document ──────────────────────────────────────────────
  setDoc(): void {
    const doc = this.store.doc;
    this.engine.setSource(doc?.source ?? null);
    if (doc) this.engine.setOutputSize({ width: doc.width, height: doc.height });
    this.fit();
  }

  // ── view ──────────────────────────────────────────────────
  private get cw() { return this.canvas.width; }
  private get ch() { return this.canvas.height; }

  private layout() {
    const r = this.el.getBoundingClientRect();
    this.engine.resize(Math.round(r.width * this.dpr), Math.round(r.height * this.dpr));
    this.compare.width = this.canvas.width; this.compare.height = this.canvas.height;
    if (this.fitted) this.fit(); else this.request();
  }

  fit(): void {
    const doc = this.store.doc;
    if (!doc) { this.request(); return; }
    const m = FIT_MARGIN * this.dpr;
    this.zoom = Math.min(1, Math.min((this.cw - 2 * m) / doc.width, (this.ch - 2 * m) / doc.height));
    if (!(this.zoom > 0)) this.zoom = MIN_ZOOM;
    this.center();
    this.fitted = true;
    this.changed();
  }

  /** Set zoom keeping the image point under (cx, cy) — canvas px — in place. Defaults to the centre. */
  zoomTo(z: number, cx = this.cw / 2, cy = this.ch / 2): void {
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const ix = this.x + cx / this.zoom, iy = this.y + cy / this.zoom;
    this.zoom = z;
    this.x = ix - cx / z; this.y = iy - cy / z;
    this.fitted = false;
    this.clampPan();
    this.changed();
  }

  zoomStep(dir: 1 | -1): void {
    const z = this.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > z * 1.001) : [...ZOOM_STEPS].reverse().find(s => s < z / 1.001);
    this.zoomTo(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
  }

  /** 100%: one image pixel per screen pixel, centred on what's in view. */
  actualSize(): void { this.zoomTo(1); }

  private center() {
    const doc = this.store.doc!;
    this.x = doc.width / 2 - this.cw / 2 / this.zoom;
    this.y = doc.height / 2 - this.ch / 2 / this.zoom;
  }

  private panBy(dxCanvas: number, dyCanvas: number) {
    this.x -= dxCanvas / this.zoom; this.y -= dyCanvas / this.zoom;
    this.fitted = false;
    this.clampPan();
    this.changed();
  }

  /** Keep at least a quarter of the viewport on the image. */
  private clampPan() {
    const doc = this.store.doc;
    if (!doc) return;
    const vw = this.cw / this.zoom, vh = this.ch / this.zoom;
    const keepX = Math.min(vw, doc.width) / 4, keepY = Math.min(vh, doc.height) / 4;
    this.x = Math.min(doc.width - keepX, Math.max(keepX - vw, this.x));
    this.y = Math.min(doc.height - keepY, Math.max(keepY - vh, this.y));
  }

  private changed() {
    this.request();
    this.listeners.forEach(fn => fn());
  }

  // ── compare with the original ─────────────────────────────
  setComparing(on: boolean): void {
    if (on === this.comparing) return;
    this.comparing = on;
    this.el.classList.toggle('is-comparing', on);
    this.request();
  }
  get isComparing() { return this.comparing; }

  // ── rendering ─────────────────────────────────────────────
  // While something is moving (a slider, a scrub, a pan or zoom) frames render at preview quality;
  // once it settles, one full-quality frame replaces it.
  private settleTimer = 0;
  private settled = true;

  request(): void {
    this.settled = false;
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => { this.settled = true; this.schedule(); }, 150);
    this.schedule();
  }

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    this.frame = 0;
    const doc = this.store.doc, look = this.store.look;
    if (!doc) { this.engine.setSource(null); return; }
    this.engine.set(toEngine(look, this.settled ? {} : { quality: PREVIEW_QUALITY }));
    this.refreshDiffusion();
    this.engine.setView({ scale: this.zoom, x: this.x, y: this.y });
    this.engine.render();

    if (this.comparing) {
      const ctx = this.compare.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.ch);
      ctx.imageSmoothingEnabled = this.zoom < 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
      ctx.drawImage(doc.source, 0, 0);
    }
  }

  /** Recompute the error-diffusion mask when anything it depends on changed (debounced, latest wins). */
  private refreshDiffusion() {
    const doc = this.store.doc, l = this.store.look;
    if (!doc || l.mode !== 'dither' || (l.dither !== 'floyd' && l.dither !== 'atkinson')) {
      if (this.diffusing) { this.diffusing = false; this.listeners.forEach(fn => fn()); }
      return;
    }
    const key = [docId(doc.source), l.dither, l.pixel, l.brightness, l.contrast, l.gamma, l.invert, l.ink, l.paper, l.transparent].join('|');
    if (key === this.diffusionKey) return;
    this.diffusionKey = key;
    this.diffusing = true;
    this.listeners.forEach(fn => fn());
    clearTimeout(this.diffusionTimer);
    this.diffusionTimer = window.setTimeout(async () => {
      const applied = await this.engine.updateDiffusion(job => this.worker.run(job));
      if (key !== this.diffusionKey) return;   // superseded; the newer run will finish the job
      this.diffusing = false;
      if (applied) this.schedule();
      this.listeners.forEach(fn => fn());
    }, 60);
  }

  // ── input ─────────────────────────────────────────────────
  private spaceHeld = false;
  setSpaceHeld(on: boolean) { this.spaceHeld = on; this.el.classList.toggle('is-grab', on); }

  private bindInput() {
    // Wheel: pinch / ⌘ / Ctrl zooms at the pointer, otherwise two-finger scroll pans (as in Figma)
    this.el.addEventListener('wheel', e => {
      if (!this.store.doc) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const cx = (e.clientX - r.left) * this.dpr, cy = (e.clientY - r.top) * this.dpr;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        this.zoomTo(this.zoom * Math.exp(-e.deltaY * unit * 0.0025), cx, cy);
      } else {
        this.panBy(-e.deltaX * unit * this.dpr, -e.deltaY * unit * this.dpr);
      }
    }, { passive: false });

    // Drag to pan (space + drag, middle button, or plain drag — the canvas has nothing else to drag).
    // Two touch points pinch-zoom around their midpoint.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; z: number } | null = null;
    const local = (x: number, y: number) => { const r = this.el.getBoundingClientRect(); return [(x - r.left) * this.dpr, (y - r.top) * this.dpr] as const; };
    const spread = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 }; };

    this.el.addEventListener('pointerdown', e => {
      if (!this.store.doc || (e.button !== 0 && e.button !== 1)) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinch = { d: spread().d, z: this.zoom };
      this.el.classList.add('is-dragging');
    });
    this.el.addEventListener('pointermove', e => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1) {
        this.panBy((e.clientX - prev.x) * this.dpr, (e.clientY - prev.y) * this.dpr);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      const before = spread();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = spread();
      // pan with the midpoint, zoom with the spread
      this.panBy((now.mx - before.mx) * this.dpr, (now.my - before.my) * this.dpr);
      if (pinch && pinch.d > 0) this.zoomTo(pinch.z * (now.d / pinch.d), ...local(now.mx, now.my));
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) this.el.classList.remove('is-dragging');
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);

    // Double-click toggles fit ↔ 100% at the pointer
    this.el.addEventListener('dblclick', e => {
      if (!this.store.doc) return;
      const r = this.el.getBoundingClientRect();
      if (this.fitted) this.zoomTo(1, (e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr);
      else this.fit();
    });
  }
}
