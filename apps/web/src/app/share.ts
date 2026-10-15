// Share links: the look (never the image) encoded in the URL hash, e.g.
//   #v1&s=line&c=6&a=30&ink=FFFFFF&paper=1F4E8C
// Short, human-readable keys; only values that differ from the defaults are written, so links stay
// short and keep working when new settings are added later. Decoding is strict per value — anything
// unknown or out of range is dropped — so a hand-edited or truncated link can never break the app.
import { DEFAULT_LOOK, type Look } from './state';
import { sanitizeLook } from './persist';   // validates and clamps

const VERSION = 'v1';

/** URL key for each look field. Never reuse or change a key: old links depend on it. */
const KEYS: Record<keyof Look, string> = {
  mode: 'm', dither: 'd', pixel: 'px',
  shape: 's', ratio: 'r', cell: 'c', angle: 'a', softness: 'e',
  brightness: 'b', contrast: 'k', gamma: 'g', invert: 'inv',
  ink: 'ink', paper: 'paper', transparent: 'only',
  crt: 'crt', scanlines: 'sl', scanlineSpacing: 'ss', rgbShift: 'rgb',
};
const FIELD_BY_KEY = Object.fromEntries(Object.entries(KEYS).map(([f, k]) => [k, f])) as Record<string, keyof Look>;

const num = (v: number) => String(Number(v.toFixed(3)));   // 0.35 → "0.35", 8 → "8"

export function encodeLook(look: Look): string {
  const parts = [VERSION];
  for (const field of Object.keys(KEYS) as (keyof Look)[]) {
    const v = look[field], d = DEFAULT_LOOK[field];
    if (v === d) continue;
    const key = KEYS[field];
    if (typeof v === 'boolean') parts.push(v ? key : `${key}=0`);
    else if (typeof v === 'number') parts.push(`${key}=${num(v)}`);
    else parts.push(`${key}=${encodeURIComponent(v.startsWith('#') ? v.slice(1) : v)}`);
  }
  return '#' + parts.join('&');
}

/** The look in a hash, or null when the hash isn't a share link. */
export function decodeLook(hash: string): Look | null {
  const parts = hash.replace(/^#/, '').split('&').filter(Boolean);
  if (parts[0] !== VERSION) return null;
  const raw: Record<string, unknown> = { ...DEFAULT_LOOK };
  for (const part of parts.slice(1)) {
    const [key = '', value] = part.split('=');
    const field = FIELD_BY_KEY[key];
    if (!field) continue;
    const def = DEFAULT_LOOK[field];
    if (typeof def === 'boolean') raw[field] = value === undefined ? true : value !== '0';
    else if (typeof def === 'number') { const n = Number(value); if (value !== undefined && value !== '' && Number.isFinite(n)) raw[field] = field === 'pixel' ? Math.round(n) : n; }
    else if (value !== undefined) {
      let s: string;
      try { s = decodeURIComponent(value); } catch { continue; }   // malformed %-escape
      if (field === 'ink' || field === 'paper') { if (/^[0-9a-f]{6}$/i.test(s)) raw[field] = `#${s.toUpperCase()}`; }
      else raw[field] = s;
    }
  }
  return sanitizeLook(raw);
}

export function shareUrl(look: Look): string {
  return location.origin + location.pathname + encodeLook(look);
}
