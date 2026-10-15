# @interfaz/halftone

Real halftone screens in WebGL2: seven AM dot shapes, six dithers and a CRT pass, tone-accurate,
live in any canvas or exported at full resolution. No dependencies.

Made by [interfaz.studio](https://interfaz.studio). Powers [Halftone Studio](https://halftone.interfaz.studio).

```bash
npm i @interfaz/halftone
```

```ts
import { Halftone } from '@interfaz/halftone';

const ht = new Halftone(canvas, { shape: 'euclidean', cell: 8, angle: 45 });
ht.setSource(image);   // any loaded image, canvas, video frame or ImageBitmap
ht.render();
```

- **Accurate tone.** Each cell averages its source in linear light, and the dot is solved so ink
  and paper mixed at viewing distance reproduce it. On a lightness ramp the worst error stays under
  1 L* (about one just-noticeable difference) for every shape, any pair of inks, light on dark
  included. The test suite measures this on a real GPU.
- **Seven dot shapes:** round, euclidean, square, diamond, ellipse, line, cross.
- **Six dithers:** Bayer 2×2 / 4×4 / 8×8, blue noise (live on the GPU), Floyd–Steinberg and
  Atkinson (error diffusion, computed in a worker).
- **CRT pass:** scanlines and RGB shift.
- **Fast.** A 4K frame renders in about 4 ms on an Apple M2. Zoomed views render only the
  visible part, at screen resolution, whatever the image size.
- **Private by design.** Everything happens on the user's GPU; nothing is uploaded anywhere.

## Contents

- [Rendering live](#rendering-live)
- [Exporting](#exporting)
- [Parameters](#parameters)
- [API](#api)
- [Dithering with error diffusion](#dithering-with-error-diffusion)
- [Zoom and pan](#zoom-and-pan)
- [Browser support](#browser-support)
- [How it works](#how-it-works)

## Rendering live

The canvas' pixel size is the output size. Rendering is explicit: call `render()` after changing
parameters, the source or the canvas size.

```ts
import { Halftone } from '@interfaz/halftone';

const canvas = document.querySelector('canvas')!;
const ht = new Halftone(canvas, { cell: 6, ink: '#111111', paper: '#F2EFE8' });

const img = new Image();
img.src = '/photo.jpg';
await img.decode();
ht.setSource(img);

function draw() {
  const r = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio;
  ht.resize(r.width * dpr, r.height * dpr);
  ht.set({ pixelRatio: dpr });   // cell sizes are in CSS pixels; keep them sharp on HiDPI
  ht.render();
}
new ResizeObserver(draw).observe(canvas);

// later
ht.set({ angle: 15, shape: 'line' });
ht.render();

// when done: frees GPU memory and gives the WebGL context back
ht.destroy();
```

Browsers cap the number of live WebGL contexts per page (Safari at about 16) and drop the oldest
beyond that. Call `destroy()` on instances you no longer need. To draw many static figures, render
them one after another with a single instance and copy each result into a 2D canvas.

## Exporting

`exportImage` renders a full-resolution image off-screen and encodes it. The output is the source
size × `scale`; `cell`, `pixel`, `scanlineSpacing` and `rgbShift` are measured in source pixels,
so a 2× export looks the same as 1×, only sharper.

```ts
import { exportImage } from '@interfaz/halftone';

const png = await exportImage(image, { shape: 'euclidean', cell: 6 }, { scale: 2 });
const url = URL.createObjectURL(png);
```

Error diffusion is computed automatically for exports. Pass `transparent: true` for a cut-out PNG
(ink only, transparent background).

## Parameters

Every parameter is optional; unspecified ones take the value from `DEFAULTS`. Invalid values throw
a `RangeError` and leave the previous parameters untouched.

| Parameter | Default | Range | What it does |
|---|---|---|---|
| `mode` | `'dots'` | `'dots'` · `'dither'` | AM dot screen, or dithered pixels each fully inked or not |
| `shape` | `'euclidean'` | see `SHAPES` | Dot shape (dots mode) |
| `ratio` | `0.6` | 0.2–1 | Ellipse only: dot height ÷ width |
| `cell` | `8` | cell × `pixelRatio` ≥ 2 | Distance between dot centres, in reference pixels |
| `angle` | `45` | any | Screen angle in degrees, counter-clockwise (print convention) |
| `softness` | `1` | ≥ 1 | Dot edge width in output pixels; 1 is crisp |
| `dither` | `'blue'` | see `DITHER_METHODS` | Dither method (dither mode) |
| `pixel` | `2` | pixel × `pixelRatio` ≥ 1 | Dither pixel size, in reference pixels |
| `brightness` | `0` | −1…1 | Lightness offset |
| `contrast` | `0` | −1…1 | Contrast around mid grey |
| `gamma` | `1` | > 0 | Above 1 lifts the midtones, below 1 deepens them |
| `invert` | `false` | | Swap light and dark before screening |
| `ink` | `'#000000'` | CSS hex, `rgb()`, `transparent` | Dot colour |
| `paper` | `'#FFFFFF'` | same | Background colour; also sets the tone (see below) |
| `transparent` | `false` | | Leave the paper out of the output |
| `fit` | `'cover'` | `'cover'` · `'contain'` · `'fill'` | How the source is placed, like CSS `object-fit` |
| `scanlines` | `0` | 0–1 | CRT scanline darkness; 0 is off |
| `scanlineSpacing` | `3` | × `pixelRatio` ≥ 2 | Scanline period, in reference pixels |
| `rgbShift` | `0` | 0–50 | CRT colour fringing: red and blue offset sideways, in reference pixels |
| `pixelRatio` | `1` | > 0 | Output pixels per reference pixel: `devicePixelRatio` live, the scale for exports |
| `quality` | `6` | 1–8 | Antialiasing subsamples per axis; 6 keeps every shape within 1 L*, 4 is ~2× faster for previews |

**Ink, paper and tone.** Ink goes where the image is closer to the ink's lightness than to the
paper's. Dark ink on light paper inks the shadows; light ink on dark paper inks the highlights,
with no need to invert. With `transparent: true` the paper isn't drawn, but its colour still sets
the tone, so pick the colour the image will sit on.

## API

### `new Halftone(canvas, params?, options?)`

- `canvas`: an `HTMLCanvasElement` or `OffscreenCanvas`.
- `params`: a partial `HalftoneParams`.
- `options.preserveDrawingBuffer`: keep the frame after compositing, needed to read pixels back
  with `drawImage` or `readPixels`. Default `false`.

Throws if WebGL2 is unavailable. Check first with `Halftone.isSupported()`.

| Member | Description |
|---|---|
| `Halftone.isSupported()` | `true` when WebGL2 can be used |
| `set(params)` | Merge new parameters (validated) |
| `params` | The current parameters, read-only |
| `setSource(source \| null)` | Upload an image, canvas, video frame or `ImageBitmap`. Call again per video frame. ImageBitmaps with transparency should be created with `{ premultiplyAlpha: 'premultiply' }` |
| `resize(width, height)` | Set the canvas' pixel size |
| `render()` | Draw a frame. A no-op while the context is lost or after `destroy()` |
| `setOutputSize({ width, height } \| null)` | A logical output size independent of the canvas (see [Zoom and pan](#zoom-and-pan)) |
| `setView({ scale, x, y, snap? })` | Which part of the output the canvas shows |
| `maxSize` | Largest image or canvas side this GPU accepts, in pixels |
| `diffusionJob()` | The error-diffusion job for the current parameters, or `null` |
| `setDiffusionMask(data, width, height)` | Use an error-diffusion result |
| `updateDiffusion(run)` | Compute and apply error diffusion with `run` (see below) |
| `destroy()` | Free GPU resources and release the context. Safe to call twice |

A lost WebGL context (GPU reset, too many contexts) is restored automatically when the browser
allows it, and the last frame is redrawn.

### `exportImage(source, params?, options?) → Promise<Blob>`

`options.scale` (default 1) multiplies the output size; `options.type` sets the MIME type
(default `image/png`).

### Constants and helpers

| Export | Description |
|---|---|
| `DEFAULTS` | The default parameters (frozen) |
| `SHAPES` | `['round', 'euclidean', 'square', 'diamond', 'ellipse', 'line', 'cross']` |
| `DITHER_METHODS` | `['bayer2', 'bayer4', 'bayer8', 'blue', 'floyd', 'atkinson']` |
| `isOrdered(method)` | `true` for methods that run on the GPU (Bayer, blue noise) |
| `MIN_CELL_PX` | Smallest cell, in output pixels (2) |
| `parseColor(css)` | CSS hex / `rgb()` / `transparent` → `[r, g, b, a]` in 0–1. Throws on anything else |
| `srgbToLinear`, `luminance`, `lightness` | The colour maths the engine uses |
| `adjustLightness(l, { brightness, contrast, gamma, invert })` | The engine's tone adjustment on the CPU, for histograms or previews |
| `circleCoverage(r)`, `circleRadius(c)` | Exact dot geometry for round dots on a unit lattice |
| `fitUv(fit, sourceSize, outputSize)` | The `object-fit` mapping the shader uses |
| `diffusionKernel(job)` | Error diffusion on the CPU, synchronous |
| `DiffusionWorker` | Runs `diffusionKernel` off the main thread, latest request wins |

## Dithering with error diffusion

Bayer and blue noise run on the GPU like dots. Floyd–Steinberg and Atkinson carry every pixel's
rounding error to the pixels after it, so they can't: they run on the CPU and the result is handed
to the engine. Until it arrives, the engine shows blue noise, so a preview is never blank.

```ts
import { Halftone, DiffusionWorker } from '@interfaz/halftone';

const worker = new DiffusionWorker();
ht.set({ mode: 'dither', dither: 'floyd', pixel: 2 });
ht.render();                                       // blue-noise preview straight away
await ht.updateDiffusion(job => worker.run(job));  // then the real thing
ht.render();
```

`DiffusionWorker` creates its worker from a `blob:` URL; under a Content Security Policy allow
`worker-src blob:`. Where workers aren't available it runs inline.

## Zoom and pan

For an interactive viewer, give the engine the image size as its output size and a view. Only the
visible part is rendered, at screen resolution.

```ts
ht.setOutputSize({ width: img.naturalWidth, height: img.naturalHeight });
ht.set({ fit: 'fill' });
ht.setView({ scale: 2, x: 400, y: 300 });   // 200 %, image pixel (400, 300) at the top-left
ht.render();
```

At whole-number zooms each output pixel is drawn as a flat block, exactly as it will export. When
zoomed out so far that dots fall under about two screen pixels, the engine shows the tone they
average to instead of aliasing into moiré. Exports never use that fallback.

## Browser support

Any browser with WebGL2: current Chrome, Edge, Firefox and Safari, on desktop and mobile. The test
suite runs in Chromium, Firefox and WebKit.

## How it works

- **Geometry.** Round dots are drawn as a union of circles across neighbouring cells; coverage to
  radius is solved exactly, including above 78.5 %, where dots spill past their cell. The other
  shapes are spot functions, the way PostScript defines screens: the threshold for every coverage
  is tabulated from the function, so any shape is tone-exact without a hand-derived formula.
- **Tone.** The source is uploaded as sRGB and mipmapped, so a cell's average is taken in linear
  light. Its CIE lightness, after brightness, contrast and gamma, is mapped onto the lightness
  range of the two inks, and coverage is solved so that ink and paper mix to that lightness.
- **Antialiasing.** Each pixel is supersampled against the dots of its cell and its eight
  neighbours, which keeps the ink area right down to sub-pixel dots and gaps.
- **CRT.** A second pass over the finished screen, in linear light. It runs only when an effect is
  on.

## License

MIT © interfaz.studio
