// Remembers the last look and image across visits (local only — nothing leaves the browser).
import { DITHER_METHODS, SHAPES } from '@interfaz/halftone';
import { DEFAULT_LOOK, type Look } from './state';

/** Range limits matching the inspector controls. Stored and shared looks are untrusted input. */
export function clampLook(l: Look): Look {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    ...l,
    cell: c(l.cell, 2, 64), angle: c(l.angle, -90, 90), softness: c(l.softness, 1, 8), ratio: c(l.ratio, 0.2, 1),
    brightness: c(l.brightness, -1, 1), contrast: c(l.contrast, -1, 1), gamma: c(l.gamma, 0.2, 3),
    pixel: Math.round(c(l.pixel, 1, 16)),
    scanlines: c(l.scanlines, 0, 1), scanlineSpacing: c(l.scanlineSpacing, 2, 16), rgbShift: c(l.rgbShift, 0, 10),
  };
}

const LOOK_KEY = 'halftone.look.v1';
const PRESETS_KEY = 'halftone.presets.v1';

export function loadLook(): Look {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) return sanitizeLook(JSON.parse(raw));
  } catch { /* storage blocked or corrupt — fall back to defaults */ }
  return { ...DEFAULT_LOOK };
}

let saveTimer = 0;
export function saveLook(look: Look): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* ignore */ }
  }, 300);
}

/** Keep only known keys with values of the right type; anything else falls back to the default. */
export function sanitizeLook(input: unknown): Look {
  const out: Look = { ...DEFAULT_LOOK };
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_LOOK) as (keyof Look)[]) {
    const v = src[key];
    if (typeof v === typeof DEFAULT_LOOK[key] && (typeof v !== 'number' || Number.isFinite(v))) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (!SHAPES.includes(out.shape)) out.shape = DEFAULT_LOOK.shape;
  if (out.mode !== 'dots' && out.mode !== 'dither') out.mode = DEFAULT_LOOK.mode;
  if (!DITHER_METHODS.includes(out.dither)) out.dither = DEFAULT_LOOK.dither;
  if (!(Number.isInteger(out.pixel) && out.pixel >= 1 && out.pixel <= 32)) out.pixel = DEFAULT_LOOK.pixel;
  if (!(out.scanlines >= 0 && out.scanlines <= 1)) out.scanlines = DEFAULT_LOOK.scanlines;
  if (!(out.scanlineSpacing >= 2 && out.scanlineSpacing <= 32)) out.scanlineSpacing = DEFAULT_LOOK.scanlineSpacing;
  if (!(out.rgbShift >= 0 && out.rgbShift <= 20)) out.rgbShift = DEFAULT_LOOK.rgbShift;
  if (!(out.ratio >= 0.2 && out.ratio <= 1)) out.ratio = DEFAULT_LOOK.ratio;
  // Colours must be #RRGGBB: anything else would make the engine throw on every frame
  if (!/^#[0-9a-f]{6}$/i.test(out.ink)) out.ink = DEFAULT_LOOK.ink;
  if (!/^#[0-9a-f]{6}$/i.test(out.paper)) out.paper = DEFAULT_LOOK.paper;
  return clampLook(out);
}

export interface StoredPreset { id: string; name: string; look: Partial<Look> }

export function loadPresets(): StoredPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch { return []; }
}

export function savePresets(presets: StoredPreset[]): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* ignore */ }
}

// ── last image, in IndexedDB (too big for localStorage) ──────────────────────
const DB = 'halftone', STORE = 'files';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLastImage(file: Blob, name: string): Promise<void> {
  try {
    const d = await db();
    d.transaction(STORE, 'readwrite').objectStore(STORE).put({ file, name }, 'last');
  } catch { /* private mode etc. — not critical */ }
}

export async function loadLastImage(): Promise<{ file: Blob; name: string } | null> {
  try {
    const d = await db();
    return await new Promise(resolve => {
      const req = d.transaction(STORE).objectStore(STORE).get('last');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function clearLastImage(): Promise<void> {
  try { (await db()).transaction(STORE, 'readwrite').objectStore(STORE).delete('last'); } catch { /* ignore */ }
}
