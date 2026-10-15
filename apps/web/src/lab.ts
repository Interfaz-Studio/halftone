// Stage-1 lab: drive the engine by hand and measure it. Not the presentation page.
import { DEFAULTS, Halftone, exportImage, type HalftoneParams } from '@interfaz/halftone';
import { chart, lightnessRamp } from './patterns';
import { measureTone as measure } from './tone';

const canvas = document.querySelector<HTMLCanvasElement>('[data-canvas]')!;
const stage = document.querySelector<HTMLElement>('[data-stage]')!;
const form = document.querySelector<HTMLFormElement>('[data-controls]')!;
const out = document.querySelector<HTMLElement>('[data-out]')!;

const ht = new Halftone(canvas, { pixelRatio: devicePixelRatio });
let source: TexImageSource & { width: number; height: number } = chart();

// ── controls ────────────────────────────────────────────────
type Num = { key: keyof HalftoneParams; min: number; max: number; step: number };
const sliders: Num[] = [
  { key: 'cell', min: 2, max: 60, step: 0.5 },
  { key: 'angle', min: -90, max: 90, step: 0.5 },
  { key: 'brightness', min: -1, max: 1, step: 0.01 },
  { key: 'contrast', min: -1, max: 1, step: 0.01 },
  { key: 'gamma', min: 0.2, max: 3, step: 0.01 },
  { key: 'softness', min: 1, max: 8, step: 0.1 },
];
for (const s of sliders) {
  form.insertAdjacentHTML('beforeend',
    `<label>${s.key}<input type="range" name="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${DEFAULTS[s.key]}"><output>${DEFAULTS[s.key]}</output></label>`);
}
form.insertAdjacentHTML('beforeend', `
  <label>ink<input type="color" name="ink" value="${DEFAULTS.ink}"><span></span></label>
  <label>paper<input type="color" name="paper" value="${DEFAULTS.paper}"><span></span></label>
  <label>invert<input type="checkbox" name="invert"><span></span></label>
  <label>fit<select name="fit"><option>cover</option><option>contain</option><option>fill</option></select><span></span></label>
  <div class="row">
    <button type="button" data-src="chart">Chart</button>
    <button type="button" data-src="ramp">L* ramp</button>
    <button type="button" data-src="/samples/demo.jpg">Demo</button>
  </div>
  <div class="row">
    <button type="button" data-swap>Swap inks</button>
    <button type="button" data-spin>Spin (fps)</button>
    <button type="button" data-measure>Measure tone</button>
    <button type="button" data-export="1">PNG 1×</button>
    <button type="button" data-export="2">PNG 2×</button>
  </div>`);

function readForm(): Partial<HalftoneParams> {
  const f = new FormData(form);
  const p: Record<string, unknown> = {};
  for (const s of sliders) p[s.key] = Number(f.get(s.key));
  p.ink = f.get('ink'); p.paper = f.get('paper'); p.invert = f.get('invert') === 'on'; p.fit = f.get('fit');
  form.querySelectorAll('output').forEach(o => { o.textContent = (o.previousElementSibling as HTMLInputElement).value; });
  return p as Partial<HalftoneParams>;
}

// ── rendering ───────────────────────────────────────────────
let queued = 0;
function draw() {
  queued = 0;
  // Canvas shows the source at its aspect ratio, as large as the stage allows
  const box = stage.getBoundingClientRect();
  const k = Math.min((box.width - 48) / source.width, (box.height - 48) / source.height);
  const cssW = Math.floor(source.width * k), cssH = Math.floor(source.height * k);
  canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
  ht.resize(cssW * devicePixelRatio, cssH * devicePixelRatio);
  try {
    ht.set({ ...readForm(), pixelRatio: devicePixelRatio });
    ht.render();
  } catch (e) { out.textContent = String(e); }
}
const schedule = () => { if (!queued) queued = requestAnimationFrame(draw); };
form.addEventListener('input', schedule);
new ResizeObserver(schedule).observe(stage);

async function load(name: string) {
  if (name === 'chart') source = chart();
  else if (name === 'ramp') source = lightnessRamp();
  else {
    const img = new Image();
    img.src = name;
    await img.decode();
    source = Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  }
  ht.setSource(source);
  schedule();
}

async function loadFile(file: File) {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'premultiply' });
  source = bmp;
  ht.setSource(bmp);
  schedule();
}

// ── tools ───────────────────────────────────────────────────
let spinning = 0;
function spin() {
  if (spinning) { cancelAnimationFrame(spinning); spinning = 0; return; }
  let frames = 0, t0 = performance.now(), a = ht.params.angle;
  const step = (now: number) => {
    a += 0.25; ht.set({ angle: ((a + 90) % 180) - 90 }); ht.render(); frames++;
    if (now - t0 > 1000) { out.textContent = `${Math.round((frames * 1000) / (now - t0))} fps at ${canvas.width}×${canvas.height}px`; frames = 0; t0 = now; }
    spinning = requestAnimationFrame(step);
  };
  spinning = requestAnimationFrame(step);
}

async function download(scale: number) {
  const t0 = performance.now();
  const blob = await exportImage(source, { ...ht.params }, { scale });
  out.textContent = `Exported ${Math.round(source.width * scale)}×${Math.round(source.height * scale)} in ${Math.round(performance.now() - t0)}ms (${(blob.size / 1e6).toFixed(2)} MB)`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `halftone-${scale}x.png` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

form.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.src) load(b.dataset.src);
  if (b.hasAttribute('data-spin')) spin();
  if (b.hasAttribute('data-swap')) {
    const ink = form.elements.namedItem('ink') as HTMLInputElement, paper = form.elements.namedItem('paper') as HTMLInputElement;
    [ink.value, paper.value] = [paper.value, ink.value]; schedule();
  }
  if (b.hasAttribute('data-measure')) {
    const r = measure(ht.params);
    out.textContent = `Tone error (worst, L*): ${r.worst.toFixed(2)}\n` + r.rows.join('\n');
  }
  if (b.dataset.export) download(Number(b.dataset.export));
});

// Drag & drop / paste
stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('is-over'); });
stage.addEventListener('dragleave', () => stage.classList.remove('is-over'));
stage.addEventListener('drop', e => {
  e.preventDefault(); stage.classList.remove('is-over');
  const f = e.dataTransfer?.files[0]; if (f) loadFile(f);
});
addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/')); if (f) loadFile(f);
});

// For automated checks
Object.assign(window, { lab: { ht, measureTone: (p: Partial<HalftoneParams> = {}) => measure({ ...ht.params, ...p }), load } });

ht.setSource(source);
schedule();
