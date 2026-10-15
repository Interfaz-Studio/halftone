/**
 * Colour helpers. Inks are given as CSS-style strings; everything the shader mixes is linear light.
 */

/** RGBA with sRGB-encoded channels in [0, 1]. */
export type RGBA = readonly [r: number, g: number, b: number, a: number];

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` (0–255, alpha 0–1 or %) or `transparent`.
 * Throws on anything else, so a typo never silently renders black.
 */
export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];

  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) throw new Error(`Invalid colour: ${input}`);
    if (hex.length <= 4) hex = [...hex].map(ch => ch + ch).join('');
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), hex.length === 8 ? n(6) : 1];
  }

  const m = /^rgba?\(\s*([^)]+)\)$/.exec(s);
  if (m?.[1]) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const channel = (v: string) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / 255);
      const alpha = (v: string) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
      const [r, g, b, a] = parts as [string, string, string, string?];
      const out: RGBA = [channel(r), channel(g), channel(b), a === undefined ? 1 : alpha(a)];
      if (out.every(v => Number.isFinite(v))) return out.map(v => Math.min(1, Math.max(0, v))) as unknown as RGBA;
    }
  }
  throw new Error(`Invalid colour: ${input}`);
}

/** sRGB transfer function, encoded → linear. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB transfer function, linear → encoded. */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Relative luminance (Rec. 709 / sRGB primaries) of linear RGB. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** CIE L* of a relative luminance, scaled to [0, 1]. */
export function lightness(y: number): number {
  return (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y) / 100;
}

/** Inverse of `lightness`: L* in [0, 1] → relative luminance. */
export function lightnessToLuminance(l: number): number {
  const L = l * 100;
  return L > 8 ? Math.pow((L + 16) / 116, 3) : L / (24389 / 27);
}
