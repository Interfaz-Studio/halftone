// App state: the editable look (params), the open document, and undo/redo history.
import { lightness, luminance, parseColor, srgbToLinear, type DitherMethod, type HalftoneParams, type Shape } from '@interfaz/halftone';

/** What the user edits. `transparent` = single-colour mode: ink only, on a transparent background
 *  (the paper colour is kept for when it's switched off). */
export interface Look {
  mode: 'dots' | 'dither';
  dither: DitherMethod;
  pixel: number;   // dither pixel size, image px
  shape: Shape;
  ratio: number;   // ellipse only
  cell: number;
  angle: number;
  softness: number;
  brightness: number;
  contrast: number;
  gamma: number;
  invert: boolean;
  ink: string;
  paper: string;
  transparent: boolean;
  // CRT effects; `crt` switches them all off without losing the values
  crt: boolean;
  scanlines: number;
  scanlineSpacing: number;
  rgbShift: number;
}

export const DEFAULT_LOOK: Readonly<Look> = Object.freeze({
  mode: 'dots', dither: 'floyd', pixel: 2,
  shape: 'euclidean', ratio: 0.6,
  cell: 8, angle: 45, softness: 1,
  brightness: 0, contrast: 0, gamma: 1, invert: false,
  ink: '#DC1B25', paper: '#080603', transparent: false,
  crt: false, scanlines: 0.35, scanlineSpacing: 3, rgbShift: 1,
});

export const TONE_KEYS = ['brightness', 'contrast', 'gamma', 'invert'] as const;

export interface Doc {
  name: string;          // file name without extension
  source: ImageBitmap;
  width: number;
  height: number;
}

/** Engine params for a look. Cell size is in source pixels; the output is the source size. */
export function toEngine(look: Look, overrides: Partial<HalftoneParams> = {}): Partial<HalftoneParams> {
  return {
    mode: look.mode, dither: look.dither, pixel: look.pixel,
    shape: look.shape, ratio: look.ratio,
    cell: look.cell, angle: look.angle, softness: look.softness,
    brightness: look.brightness, contrast: look.contrast, gamma: look.gamma, invert: look.invert,
    ink: look.ink, paper: look.transparent ? impliedPaper(look.ink) : look.paper, transparent: look.transparent,
    scanlines: look.crt ? look.scanlines : 0, scanlineSpacing: look.scanlineSpacing, rgbShift: look.crt ? look.rgbShift : 0,
    fit: 'fill', quality: 6,
    ...overrides,
  };
}

/**
 * Ink-only mode has no paper, but the tone still needs a ground to be measured against: a dark ink
 * fills the image's shadows (as on white), a light ink its highlights (as on black).
 */
export function impliedPaper(ink: string): string {
  const [r, g, b] = parseColor(ink);
  return lightness(luminance(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))) < 0.5 ? '#FFFFFF' : '#000000';
}

const sameLook = (a: Look, b: Look) => (Object.keys(a) as (keyof Look)[]).every(k => a[k] === b[k]);

type Listener = (why: 'look' | 'doc' | 'history') => void;

export class Store {
  look: Look;
  doc: Doc | null = null;
  private past: Look[] = [];
  private future: Look[] = [];
  private base: Look | null = null;   // look before the edit in progress (a drag, a scrub…)
  private listeners = new Set<Listener>();

  constructor(initial: Look) {
    this.look = { ...initial };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(why: Parameters<Listener>[0]) {
    this.listeners.forEach(fn => fn(why));
  }

  /** Live change while an edit is in progress (e.g. dragging a slider). Not yet an undo step. */
  preview(patch: Partial<Look>): void {
    this.base ??= { ...this.look };
    this.look = { ...this.look, ...patch };
    this.emit('look');
  }

  /** Finish an edit: one undo step from the look before it started to the look now. */
  commit(patch: Partial<Look> = {}): void {
    const before = this.base ?? { ...this.look };
    this.base = null;
    this.look = { ...this.look, ...patch };
    if (sameLook(before, this.look)) return;
    this.past.push(before);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.emit('look');
    this.emit('history');
  }

  /** Abandon the edit in progress (Escape). */
  cancel(): void {
    if (!this.base) return;
    this.look = this.base;
    this.base = null;
    this.emit('look');
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.base = null;
    this.future.push(this.look);
    this.look = prev;
    this.emit('look');
    this.emit('history');
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.base = null;
    this.past.push(this.look);
    this.look = next;
    this.emit('look');
    this.emit('history');
  }

  setDoc(doc: Doc | null): void {
    this.doc?.source.close();
    this.doc = doc;
    this.emit('doc');
  }
}
