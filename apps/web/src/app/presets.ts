// Built-in looks plus the user's saved ones. A preset sets the screen and colours, not the tone —
// tone adjustments belong to the image being worked on.
import { loadPresets, sanitizeLook, savePresets, type StoredPreset } from './persist';
import type { Look } from './state';

export const PRESET_KEYS = ['mode', 'dither', 'pixel', 'shape', 'ratio', 'cell', 'angle', 'softness', 'ink', 'paper', 'transparent', 'crt', 'scanlines', 'scanlineSpacing', 'rgbShift'] as const;
export type PresetLook = Pick<Look, (typeof PRESET_KEYS)[number]>;

export interface Preset { id: string; name: string; look: PresetLook; builtin: boolean }

const builtin = (id: string, name: string, look: Partial<PresetLook>): Preset => ({
  id, name, builtin: true,
  look: { mode: 'dots', dither: 'floyd', pixel: 2, shape: 'euclidean', ratio: 0.6, cell: 8, angle: 45, softness: 1, ink: '#000000', paper: '#ffffff', transparent: false, crt: false, scanlines: 0.35, scanlineSpacing: 3, rgbShift: 1, ...look },
});

export const BUILTIN: readonly Preset[] = [
  builtin('interfaz', 'Interfaz', { ink: '#DC1B25', paper: '#080603' }),
  builtin('interfaz-crt', 'Interfaz CRT', { ink: '#DC1B25', paper: '#080603', crt: true, scanlines: 0.4, scanlineSpacing: 3, rgbShift: 1 }),
  builtin('terminal', 'Terminal', { mode: 'dither', dither: 'bayer8', pixel: 2, ink: '#33FF66', paper: '#06140A', crt: true, scanlines: 0.5, scanlineSpacing: 4, rgbShift: 0.75 }),
  builtin('newsprint', 'Newsprint', { ink: '#1C1B1A', paper: '#EEE9DE', cell: 6 }),
  builtin('riso-blue', 'Riso blue', { shape: 'round', ink: '#0078BF', paper: '#F3EFE6', cell: 7, angle: 15 }),
  builtin('riso-pink', 'Riso fluo pink', { shape: 'round', ink: '#FF48B0', paper: '#F3EFE6', cell: 9, angle: 75 }),
  builtin('night', 'Night', { ink: '#F0DFC0', paper: '#0B0B0B', cell: 6 }),
  builtin('blueprint', 'Blueprint', { shape: 'line', ink: '#FFFFFF', paper: '#1F4E8C', cell: 6, angle: 30 }),
  builtin('cutout', 'Cut-out', { ink: '#000000', paper: '#FFFFFF', transparent: true, cell: 8 }),
  builtin('one-bit', '1-bit', { mode: 'dither', dither: 'floyd', pixel: 2, ink: '#111111', paper: '#F2F2F2' }),
  builtin('classic-mac', 'Classic Mac', { mode: 'dither', dither: 'atkinson', pixel: 2, ink: '#000000', paper: '#FFFFFF' }),
  builtin('8-bit', '8-bit', { mode: 'dither', dither: 'bayer4', pixel: 3, ink: '#0F380F', paper: '#9BBC0F' }),
];

export function allPresets(): Preset[] {
  const user = loadPresets().map(p => ({ id: p.id, name: p.name.slice(0, 40), builtin: false, look: pick(sanitizeLook({ ...BUILTIN[0]!.look, ...p.look })) }));
  return [...BUILTIN, ...user];
}

export function pick(look: Look): PresetLook {
  return Object.fromEntries(PRESET_KEYS.map(k => [k, look[k]])) as unknown as PresetLook;
}

/** The preset the look currently matches exactly, if any. */
export function matching(look: Look): Preset | undefined {
  const cur = pick(look);
  return allPresets().find(p => PRESET_KEYS.every(k => p.look[k] === cur[k]));
}

export function addUserPreset(name: string, look: Look): Preset {
  const list = loadPresets();
  const stored: StoredPreset = { id: `user-${Date.now().toString(36)}`, name: name.trim().slice(0, 40), look: pick(look) };
  savePresets([...list, stored]);
  return { ...stored, look: pick(look), builtin: false };
}

export function removeUserPreset(id: string): void {
  savePresets(loadPresets().filter(p => p.id !== id));
}
