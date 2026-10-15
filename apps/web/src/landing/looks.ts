// Looks shown on the presentation page. Each one also deep-links into the studio, pre-set.
import { DEFAULT_LOOK, type Look } from '../app/state';
import { encodeLook } from '../app/share';

export interface ShowLook { id: string; name: string; note: string; look: Partial<Look> }

const W = '#F4F4F1', K = '#050506';

/** Hero chips: one tap swaps the live render. */
export const HERO_LOOKS: ShowLook[] = [
  { id: 'euclid', name: 'Euclidean', note: '', look: { shape: 'euclidean', cell: 5, angle: 45, ink: W, paper: K } },
  { id: 'round', name: 'Round', note: '', look: { shape: 'round', cell: 9, angle: 15, ink: '#DC1B25', paper: '#0B0907' } },
  { id: 'line', name: 'Line', note: '', look: { shape: 'line', cell: 6, angle: 30, ink: '#FFFFFF', paper: '#1F4E8C' } },
  { id: 'cross', name: 'Cross', note: '', look: { shape: 'cross', cell: 9, angle: 45, ink: W, paper: K } },
  { id: 'ellipse', name: 'Ellipse', note: '', look: { shape: 'ellipse', ratio: 0.55, cell: 8, angle: 60, ink: '#1C1B1A', paper: '#EEE9DE' } },
  { id: 'floyd', name: 'Floyd–Steinberg', note: '', look: { mode: 'dither', dither: 'floyd', pixel: 3, ink: W, paper: K } },
  { id: 'atkinson', name: 'Atkinson', note: '', look: { mode: 'dither', dither: 'atkinson', pixel: 3, ink: '#000000', paper: '#FFFFFF' } },
  { id: 'bayer', name: 'Bayer', note: '', look: { mode: 'dither', dither: 'bayer4', pixel: 4, ink: '#0F380F', paper: '#9BBC0F' } },
  { id: 'crt', name: 'CRT', note: '', look: { mode: 'dither', dither: 'bayer8', pixel: 3, ink: '#33FF66', paper: '#06140A', crt: true, scanlines: 0.5, scanlineSpacing: 4, rgbShift: 1 } },
];

/** Style cards, one per screen, each opening the studio with that look. */
export const CARD_LOOKS: ShowLook[] = [
  { id: 'euclidean', name: 'Euclidean dot', note: 'The photographic standard. Dots grow round, meet as a checkerboard at 50 %, then close to round holes.', look: { shape: 'euclidean', cell: 6, ink: W, paper: K } },
  { id: 'round', name: 'Round dot', note: 'Circles that merge into solid shadows — the newspaper look.', look: { shape: 'round', cell: 8, angle: 15, ink: '#1C1B1A', paper: '#EEE9DE' } },
  { id: 'ellipse', name: 'Chain dot', note: 'Elliptical dots that link up through the midtones for smooth skin and skies.', look: { shape: 'ellipse', ratio: 0.55, cell: 7, angle: 60, ink: '#DC1B25', paper: '#0B0907' } },
  { id: 'line', name: 'Line screen', note: 'Parallel lines that thicken with tone. Engraving, currency, blueprint.', look: { shape: 'line', cell: 5, angle: 30, ink: '#FFFFFF', paper: '#1F4E8C' } },
  { id: 'square', name: 'Square dot', note: 'Hard-edged squares: a graphic, digital texture.', look: { shape: 'square', cell: 8, angle: 0, ink: W, paper: K } },
  { id: 'cross', name: 'Cross', note: 'Plus signs on a grid, woven like a textile.', look: { shape: 'cross', cell: 8, angle: 45, ink: '#FF48B0', paper: '#F3EFE6' } },
  { id: 'floyd', name: 'Floyd–Steinberg', note: 'Error diffusion, the most faithful dither — organic grain, every tone kept.', look: { mode: 'dither', dither: 'floyd', pixel: 2, ink: W, paper: K } },
  { id: 'atkinson', name: 'Atkinson', note: 'The early-Macintosh dither: crisp, contrasty, highlights blown out.', look: { mode: 'dither', dither: 'atkinson', pixel: 2, ink: '#000000', paper: '#FFFFFF' } },
  { id: 'bayer', name: 'Bayer & CRT', note: 'An ordered crosshatch behind scanlines and colour fringing — a monitor from 1983.', look: { mode: 'dither', dither: 'bayer8', pixel: 2, ink: '#33FF66', paper: '#06140A', crt: true, scanlines: 0.5, scanlineSpacing: 4, rgbShift: 1 } },
];

export const fullLook = (l: Partial<Look>): Look => ({ ...DEFAULT_LOOK, ...l });
export const studioHref = (l: Partial<Look>) => `/studio/${encodeLook(fullLook(l))}`;
