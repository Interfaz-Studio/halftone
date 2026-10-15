// The two tile pickers of the Screen section: dot shapes and dither methods.
import { DITHER_METHODS, SHAPES, type DitherMethod, type Shape } from '@interfaz/halftone';
import type { Control } from './controls';
import type { Store } from './state';
import { tilePicker } from './tile-picker';

export const SHAPE_INFO: Record<Shape, { name: string; note: string }> = {
  round: { name: 'Round', note: 'Circles that merge into solid shadows.' },
  euclidean: { name: 'Euclidean', note: 'The photographic standard — dots meet as a checkerboard at 50%.' },
  square: { name: 'Square', note: 'Hard-edged squares; a graphic, digital texture.' },
  diamond: { name: 'Diamond', note: 'Rotated squares that join at their points.' },
  ellipse: { name: 'Ellipse', note: 'Chain dots that link up in the midtones for smooth transitions.' },
  line: { name: 'Line', note: 'Parallel lines that thicken with tone — engraving-like.' },
  cross: { name: 'Cross', note: 'Plus signs; a woven, textile texture.' },
};

export const DITHER_INFO: Record<DitherMethod, { name: string; note: string }> = {
  bayer2: { name: 'Bayer 2×2', note: 'Ordered pattern with only 5 tone levels — chunky and retro.' },
  bayer4: { name: 'Bayer 4×4', note: '17 tone levels in a regular crosshatch — the classic 8-bit look.' },
  bayer8: { name: 'Bayer 8×8', note: '65 tone levels; a fine, regular texture.' },
  blue: { name: 'Blue noise', note: 'Even, pattern-free grain with smooth, accurate tone.' },
  floyd: { name: 'Floyd–Steinberg', note: 'Error diffusion: the most faithful tone, with an organic texture.' },
  atkinson: { name: 'Atkinson', note: 'The early Macintosh look — crisp, contrasty, extremes blown out.' },
};

export function shapePicker(store: Store): Control {
  return tilePicker<Shape>(store, {
    label: 'Dot shape',
    items: SHAPES.map(s => ({ value: s, ...SHAPE_INFO[s] })),
    get: () => store.look.shape,
    set: shape => store.commit({ shape }),
    tileParams: shape => ({ mode: 'dots', shape, ratio: 0.6 }),
  });
}

export function ditherPicker(store: Store): Control {
  return tilePicker<DitherMethod>(store, {
    label: 'Dither method',
    items: DITHER_METHODS.map(m => ({ value: m, ...DITHER_INFO[m] })),
    get: () => store.look.dither,
    set: dither => store.commit({ dither }),
    tileParams: dither => ({ mode: 'dither', dither, pixel: 2 }),
  });
}
