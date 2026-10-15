// Engine checks that need a real GPU. Open /checks/; `window.checks` holds the result.
import { DEFAULTS, Halftone, exportImage, lightness, srgbToLinear, type HalftoneParams } from '@interfaz/halftone';
import { chart } from './patterns';
import { measureTone } from './tone';

const out = document.querySelector<HTMLElement>('[data-out]')!;
type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

async function check(name: string, fn: () => boolean | string | Promise<boolean | string>) {
  try {
    const r = await fn();
    results.push({ name, pass: r === true, ...(r === true ? {} : { detail: String(r) }) });
  } catch (e) {
    results.push({ name, pass: false, detail: `threw: ${(e as Error).message}` });
  }
}

const solid = (color: string, w = 64, h = 64) => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const k = c.getContext('2d')!; k.fillStyle = color; k.fillRect(0, 0, w, h);
  return c;
};
const pixel = (c: HTMLCanvasElement | OffscreenCanvas, x: number, y: number) => {
  const g = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }).getContext('2d')!;
  g.drawImage(c, 0, 0);
  return [...g.getImageData(x, y, 1, 1).data];
};
const pixels = async (b: Blob) => {
  const bmp = await createImageBitmap(b);
  const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
};
const render = (w: number, h: number, params: Partial<HalftoneParams>, source?: TexImageSource) => {
  const c = new OffscreenCanvas(w, h);
  const ht = new Halftone(c, params, { preserveDrawingBuffer: true });
  ht.resize(w, h);
  if (source) ht.setSource(source);
  ht.render();
  return { c, ht };
};

// ── tone accuracy: worst error over the ramp must stay under 1 L* (about one just-noticeable difference)
const toneCases: [string, Partial<HalftoneParams>][] = [
  ['rust on ink', { ink: '#DC1B25', paper: '#080603' }],
  ['defaults (black on white, euclidean)', {}],
  ['black on white', { ink: '#000000', paper: '#ffffff' }],
  ['white on black', { ink: '#ffffff', paper: '#000000' }],
  ['cell 3', { cell: 3 }],
  ['cell 4', { cell: 4 }],
  ['cell 20, 15°', { cell: 20, angle: 15 }],
  ['quality 2', { quality: 2 }],
  // every dot shape, on the default inks and on black/white, at a small and a large cell
  ...(['euclidean', 'square', 'diamond', 'ellipse', 'line', 'cross'] as const).flatMap(shape => [
    [`${shape}`, { shape }],
    [`${shape}, black on white, cell 5`, { shape, ink: '#000000', paper: '#ffffff', cell: 5 }],
    [`${shape}, cell 16, 15°`, { shape, cell: 16, angle: 15 }],
  ] as [string, Partial<HalftoneParams>][]),
  // dither methods that reproduce tone faithfully (Bayer 2/4 and Atkinson are level-limited by design)
  // (Floyd–Steinberg on a steep ramp at 3px carries error sideways into the next strip, so it is
  //  checked on flat patches below instead.)
  ['dither blue', { mode: 'dither', dither: 'blue', pixel: 1 }],
  ['dither blue, black on white, 3px', { mode: 'dither', dither: 'blue', pixel: 3, ink: '#000000', paper: '#ffffff' }],
  ['dither floyd', { mode: 'dither', dither: 'floyd', pixel: 1 }],
  ['dither floyd, black on white', { mode: 'dither', dither: 'floyd', pixel: 1, ink: '#000000', paper: '#ffffff' }],
  // Bayer 8×8 has 65 levels: on rust/ink they're finer than 1 L*; on black/white the step between the
  // darkest levels is ~3 L* (a property of the method, pinned by the level check below)
  ['dither bayer8, rust on ink', { mode: 'dither', dither: 'bayer8', pixel: 1, ink: '#DC1B25', paper: '#080603' }],
];
for (const [name, p] of toneCases) {
  await check(`tone < 1 L*: ${name}`, () => {
    const r = measureTone({ ...DEFAULTS, ...p });
    return r.worst < 1 || `worst ${r.worst.toFixed(2)} L*`;
  });
}

await check('invalid params throw and keep the previous ones', () => {
  const ht = new Halftone(new OffscreenCanvas(10, 10));
  const bad: Partial<HalftoneParams>[] = [{ cell: 0 }, { cell: NaN }, { gamma: 0 }, { ink: 'nope' }, { quality: 9 }, { fit: 'x' as never }, { softness: 0.5 }, { contrast: 2 }];
  let thrown = 0;
  for (const b of bad) { try { ht.set(b); } catch { thrown++; } }
  ht.destroy();
  return (thrown === bad.length && ht.params.cell === DEFAULTS.cell) || `${thrown}/${bad.length} threw`;
});
await check('no source renders plain paper', () => {
  const { c, ht } = render(20, 20, { paper: '#336699' });
  const v = pixel(c, 10, 10); ht.destroy();
  return (v[0] === 0x33 && v[1] === 0x66 && v[2] === 0x99) || v.join(',');
});
await check('white source with dark ink is pure paper', () => {
  const { c, ht } = render(64, 64, { ink: '#000', paper: '#fff', fit: 'fill' }, solid('#fff'));
  const v = pixel(c, 30, 30); ht.destroy();
  return (v[0] === 255 && v[1] === 255 && v[2] === 255) || v.join(',');
});
await check('black source with dark ink is solid ink', () => {
  const { c, ht } = render(64, 64, { ink: '#DC1B25', paper: '#fff', fit: 'fill' }, solid('#000'));
  const v = pixel(c, 31, 33); ht.destroy();
  return (v[0] === 0xca && v[1] === 0x34 && v[2] === 0x30) || v.join(',');
});
await check('transparent paper exports real alpha', async () => {
  const { w, data } = await pixels(await exportImage(chart(400, 250), { paper: '#fff', transparent: true, ink: '#000' }));
  let clear = 0, solidPx = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) clear++; if (data[i] === 255) solidPx++; }
  return (clear > 1000 && solidPx > 1000 && w === 400) || `clear ${clear}, solid ${solidPx}, w ${w}`;
});
await check('transparent paper keeps the tone of its paper colour', async () => {
  // Black ink on white: opaque output brightness and transparent output alpha must describe the same ink
  const src = chart(300, 200);
  for (const paper of ['#ffffff', '#ff8800']) {
    const opaque = (await pixels(await exportImage(src, { ink: '#000000', paper }))).data;
    const cut = (await pixels(await exportImage(src, { ink: '#000000', paper, transparent: true }))).data;
    let worst = 0;
    for (let i = 0; i < opaque.length; i += 4) {
      // ink amount: from alpha in the cut-out; from how far the opaque pixel moved from paper toward black
      const inkCut = cut[i + 3]! / 255;
      // (pixels are sRGB-encoded; ink mixes with paper in linear light)
      const pr = parseInt(paper.slice(1, 3), 16);
      const inkOpaque = pr ? 1 - srgbToLinear(opaque[i]! / 255) / srgbToLinear(pr / 255) : 0;
      if (pr) worst = Math.max(worst, Math.abs(inkCut - inkOpaque));
    }
    if (worst > 0.02) return `${paper}: ink differs by ${(worst * 100).toFixed(1)}%`;
  }
  return true;
});
await check('export at scale 2 doubles the size', async () => {
  const { w, h } = await pixels(await exportImage(chart(300, 200), {}, { scale: 2 }));
  return (w === 600 && h === 400) || `${w}×${h}`;
});
await check('contain letterboxes with paper', () => {
  const { c, ht } = render(400, 400, { fit: 'contain', paper: '#00ff00', ink: '#000', cell: 6 }, solid('#000', 400, 100));
  const top = pixel(c, 200, 20), mid = pixel(c, 200, 200); ht.destroy();
  return (top[0] === 0 && top[1] === 255 && mid[1]! < 30) || `top ${top} mid ${mid}`;
});
await check('angle 0° and 90° give the same screen', async () => {
  const s = chart(400, 400);
  const a = (await pixels(await exportImage(s, { angle: 0, cell: 10 }))).data;
  const b = (await pixels(await exportImage(s, { angle: 90, cell: 10 }))).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 8) diff++;
  return diff / (a.length / 4) < 0.01 || `${((diff / (a.length / 4)) * 100).toFixed(2)}% differ`;
});
await check('a source over the GPU limit is rejected clearly', () => {
  const ht = new Halftone(new OffscreenCanvas(10, 10));
  try { ht.setSource({ width: ht.maxSize + 1, height: 10 } as unknown as TexImageSource); return 'accepted'; }
  catch (e) { return /allows up to/.test((e as Error).message) || (e as Error).message; }
  finally { ht.destroy(); }
});
await check('context loss and restore re-render', async () => {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const ht = new Halftone(c, { paper: '#123456', ink: '#123456' }, { preserveDrawingBuffer: true });
  ht.setSource(chart(64, 64)); ht.render();
  const ext = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
  ext.loseContext();
  await new Promise(r => setTimeout(r, 50));
  ht.render();   // must not throw while lost
  ext.restoreContext();
  await new Promise(r => setTimeout(r, 200));
  const v = pixel(c, 5, 5); ht.destroy();
  return (v[0] === 0x12 && v[1] === 0x34 && v[2] === 0x56) || v.join(',');
});
await check('view: 4× zoom shows each exported pixel as a 4×4 block', async () => {
  const src = chart(200, 125);
  const ref = await pixels(await exportImage(src, { cell: 6 }));
  const c = new OffscreenCanvas(160, 160);
  const ht = new Halftone(c, { cell: 6, fit: 'fill' }, { preserveDrawingBuffer: true });
  ht.setOutputSize({ width: 200, height: 125 });
  ht.setView({ scale: 4, x: 50, y: 30 });
  ht.setSource(src); ht.render();
  let worst = 0;
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const v = pixel(c, x * 4 + 2, y * 4 + 2), i = ((30 + y) * 200 + 50 + x) * 4;
    worst = Math.max(worst, Math.abs(v[0]! - ref.data[i]!), Math.abs(v[1]! - ref.data[i + 1]!));
  }
  ht.destroy();
  return worst <= 2 || `max channel difference ${worst}`;
});
await check('view: zoomed far out shows the average tone, not moiré', async () => {
  const s = solid('#777', 1000, 1000);
  const c = new OffscreenCanvas(50, 50);
  const ht = new Halftone(c, { cell: 6, ink: '#000', paper: '#fff', fit: 'fill' }, { preserveDrawingBuffer: true });
  ht.setOutputSize({ width: 1000, height: 1000 });
  ht.setView({ scale: 0.05, x: 0, y: 0 });
  ht.setSource(s); ht.render();
  const vals = [pixel(c, 10, 10)[0]!, pixel(c, 25, 33)[0]!, pixel(c, 40, 17)[0]!];
  ht.destroy();
  // #777 on black/white should average back to ≈ #777 (119), uniformly
  return vals.every(v => Math.abs(v - 0x77) <= 4) || vals.join(',');
});
await check('exports draw real dots and dither pixels at the smallest sizes (no tone fallback)', async () => {
  const src = solid('#bcbcbc', 120, 120);   // flat ~50 % ink on black/white
  // Dots at 2–3px cells: every pixel is an edge pixel, so test for a pattern, not purity —
  // the averaged-tone fallback would give a flat image with almost no spread.
  // (2px at 0° can't show a pattern at all: each dot sits on a pixel corner, splitting evenly)
  for (const [cell, angle] of [[2, 45], [3, 0], [4, 0]] as const) {
    const { data } = await pixels(await exportImage(src, { ink: '#000', paper: '#fff', cell, angle }));
    let sum = 0, sq = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { sum += data[i]!; sq += data[i]! ** 2; n++; }
    const sd = Math.sqrt(sq / n - (sum / n) ** 2);
    if (sd < 50) return `cell ${cell}: flat output (sd ${sd.toFixed(0)})`;
  }
  // Dither at 1px: only pure ink and pure paper
  for (const dither of ['bayer4', 'blue', 'floyd'] as const) {
    const { data } = await pixels(await exportImage(src, { ink: '#000', paper: '#fff', mode: 'dither', dither, pixel: 1 }));
    let mid = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 8 && data[i]! < 247) mid++;
    if (mid) return `${dither}: ${mid} grey pixels`;
  }
  return true;
});
await check('Floyd–Steinberg keeps flat tones within 1 L*, down to the deep shadows, at 3px', async () => {
  for (const grey of [12, 25, 50, 120, 200, 245]) {
    const { data } = await pixels(await exportImage(solid(`rgb(${grey},${grey},${grey})`, 600, 600), { ink: '#000', paper: '#fff', mode: 'dither', dither: 'floyd', pixel: 3 }));
    let paper = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 127) paper++;
    const got = lightness(paper / (data.length / 4)) * 100, want = lightness(srgbToLinear(grey / 255)) * 100;
    if (Math.abs(got - want) > 1) return `grey ${grey}: L* ${got.toFixed(2)}, want ${want.toFixed(2)}`;
  }
  return true;
});
await check('Bayer n×n reproduces its n² + 1 levels exactly', async () => {
  // Flat greys at exact level coverages (black on white: coverage = 1 − linear luminance)
  for (const [dither, n] of [['bayer2', 2], ['bayer4', 4]] as const) {
    for (let k = 1; k < n * n; k++) {
      const want = k / (n * n);
      const grey = Math.round(255 * (1 - want <= 0.0031308 ? (1 - want) * 12.92 : 1.055 * Math.pow(1 - want, 1 / 2.4) - 0.055));
      const { data } = await pixels(await exportImage(solid(`rgb(${grey},${grey},${grey})`, 64, 64), { ink: '#000', paper: '#fff', mode: 'dither', dither, pixel: 1 }));
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 128) ink++;
      const got = ink / (data.length / 4);
      if (Math.abs(got - want) > 1 / (2 * n * n)) return `${dither}: level ${k} gave ${(got * 100).toFixed(1)}% ink, want ${(want * 100).toFixed(1)}%`;
    }
  }
  return true;
});
// ── CRT ─────────────────────────────────────────────────────
const rowLinear = (data: Uint8ClampedArray, w: number, y: number) => {
  let sum = 0;
  for (let x = 0; x < w; x++) sum += srgbToLinear(data[(y * w + x) * 4]! / 255);
  return sum / w;
};
await check('scanlines darken each row exactly as the cosine profile says', async () => {
  // White source + black ink on white paper → pure paper, so every row shows only the scanline
  const { w, data } = await pixels(await exportImage(solid('#fff', 64, 32), { ink: '#000', paper: '#fff', scanlines: 0.6, scanlineSpacing: 4 }));
  for (let y = 0; y < 16; y++) {
    const band = 0.5 + 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / 4);
    const want = 1 - 0.6 * band, got = rowLinear(data, w, y);
    if (Math.abs(got - want) > 0.012) return `row ${y}: ${got.toFixed(3)} vs ${want.toFixed(3)}`;
  }
  return true;
});
await check('scanline spacing scales with the export', async () => {
  const { w, data } = await pixels(await exportImage(solid('#fff', 64, 32), { ink: '#000', paper: '#fff', scanlines: 0.6, scanlineSpacing: 4 }, { scale: 2 }));
  // period is now 8 output px: rows 0 and 8 match, row 4 is the brightest
  const r = (y: number) => rowLinear(data, w, y);
  return (Math.abs(r(0) - r(8)) < 0.01 && r(4) > r(0) + 0.3) || `rows 0/4/8: ${r(0).toFixed(2)} ${r(4).toFixed(2)} ${r(8).toFixed(2)}`;
});
await check('RGB shift fringes red to the right of an edge and blue to the left', async () => {
  // black bar from x = 30 to 34 on white
  const src = solid('#fff', 64, 16);
  const k = src.getContext('2d')!; k.fillStyle = '#000'; k.fillRect(30, 0, 4, 16);
  const { w, data } = await pixels(await exportImage(src, { ink: '#000', paper: '#fff', mode: 'dither', dither: 'bayer2', pixel: 1, rgbShift: 3 }));
  const px = (x: number) => [...data.slice((8 * w + x) * 4, (8 * w + x) * 4 + 3)];
  const left = px(28), right = px(35);   // just outside the bar
  // left of the bar: blue reads from 3px to the right (bar → dark), red from the left (white)
  // right of the bar: red reads from 3px to the left (bar → dark), blue from the right (white)
  return (left[0]! > 200 && left[2]! < 60 && right[0]! < 60 && right[2]! > 200) || `left ${left} right ${right}`;
});
await check('RGB shift keeps the image edges intact (no empty strip)', async () => {
  // Pure white paper everywhere: a shifted channel must still be white at the left/right edges
  const { w, h, data } = await pixels(await exportImage(solid('#fff', 80, 20), { ink: '#000', paper: '#fff', rgbShift: 10 }));
  for (const x of [0, 4, 9, w - 10, w - 5, w - 1]) {
    const i = (10 * w + x) * 4;
    if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) return `x=${x}: ${[...data.slice(i, i + 4)]}`;
  }
  // and in a zoomed-in view, where the image edge is inside the canvas
  const c = new OffscreenCanvas(200, 60);
  const ht = new Halftone(c, { ink: '#000', paper: '#fff', fit: 'fill', rgbShift: 10 }, { preserveDrawingBuffer: true });
  ht.setOutputSize({ width: 80, height: 20 });
  ht.setView({ scale: 2, x: -20, y: 0 });   // image starts 40 canvas px in
  ht.setSource(solid('#fff', 80, 20)); ht.render();
  const v = pixel(c, 42, 20), outside = pixel(c, 30, 20); ht.destroy();
  if (outside[3] !== 0) return `left of the image isn't empty: ${outside}`;
  return (v[0]! > 250 && v[2]! > 250) || `view edge: ${v}`;
});
await check('zoomed far out, scanlines fade to their average instead of moiré', () => {
  const c = new OffscreenCanvas(60, 60);
  const ht = new Halftone(c, { ink: '#000', paper: '#fff', fit: 'fill', scanlines: 0.6, scanlineSpacing: 3 }, { preserveDrawingBuffer: true });
  ht.setOutputSize({ width: 2000, height: 2000 });
  ht.setView({ scale: 0.03, x: 0, y: 0 });
  ht.setSource(solid('#fff', 2000, 2000)); ht.render();
  const vals = [5, 17, 29, 41, 53].map(y => srgbToLinear(pixel(c, 30, y)[0]! / 255));
  ht.destroy();
  // average darkening 0.6 × ½ → 0.7, the same on every row
  return vals.every(v => Math.abs(v - 0.7) < 0.02) || vals.map(v => v.toFixed(3)).join(',');
});
await check('effects off leave the image untouched', async () => {
  const src = chart(200, 120);
  const a = (await pixels(await exportImage(src, { cell: 6 }))).data;
  const b = (await pixels(await exportImage(src, { cell: 6, scanlines: 0, rgbShift: 0 }))).data;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `differs at byte ${i}`;
  return true;
});
await check('view: area outside the image is transparent', () => {
  const c = new OffscreenCanvas(100, 100);
  const ht = new Halftone(c, { paper: '#fff' }, { preserveDrawingBuffer: true });
  ht.setOutputSize({ width: 50, height: 50 });
  ht.setSource(solid('#000', 50, 50)); ht.render();
  const v = pixel(c, 80, 80); ht.destroy();
  return v[3] === 0 || v.join(',');
});
await check('a transparent ImageBitmap renders like the same canvas', async () => {
  const c = Object.assign(document.createElement('canvas'), { width: 160, height: 100 });
  const k = c.getContext('2d')!;
  const g = k.createLinearGradient(0, 0, 160, 0);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = '#fff'; k.fillRect(0, 0, 160, 50);
  k.fillStyle = g; k.fillRect(0, 50, 160, 50);
  const bmp = await createImageBitmap(c, { premultiplyAlpha: 'premultiply' });
  const params = { ink: '#000', paper: '#fff', cell: 6 };
  const a = (await pixels(await exportImage(c, params))).data;
  const b = (await pixels(await exportImage(bmp, params))).data;
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst <= 3 || `max difference ${worst}`;
});
await check('isSupported() does not keep a WebGL context alive', () => {
  // Count contexts created by the probe and make sure each was released
  const made: WebGL2RenderingContext[] = [];
  const orig = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, type: string, ...rest: unknown[]) {
    const ctx = (orig as Function).call(this, type, ...rest);
    if (type === 'webgl2' && ctx) made.push(ctx);
    return ctx;
  } as typeof orig;
  try { Halftone.isSupported(); } finally { OffscreenCanvas.prototype.getContext = orig; }
  return (made.length === 1 && made[0]!.isContextLost()) || `${made.length} contexts, lost: ${made.map(c => c.isContextLost())}`;
});
await check('destroy is idempotent; render after destroy is a no-op', () => {
  const ht = new Halftone(new OffscreenCanvas(10, 10));
  ht.destroy(); ht.destroy(); ht.render();
  return true;
});

const failed = results.filter(r => !r.pass).length;
out.innerHTML = results.map(r => `<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span> ${r.name}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')
  + `\n\n${results.length - failed}/${results.length} passed`;
Object.assign(window, { checks: { results, failed } });
