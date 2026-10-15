// Halftone engine — the studio tool. Wires the store, viewport, inspector, dialogs and shortcuts.
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/jetbrains-mono';
import { Halftone } from '@interfaz/halftone';
import { h } from './controls';
import { ICONS } from './icons';
import { MARK_SVG } from '../brand';
import { ExportDialog, MOD, ShortcutsDialog, shareLink, toast } from './dialogs';
import { decodeLook, shareUrl } from './share';
import { Inspector } from './inspector';
import { DITHER_INFO, SHAPE_INFO } from './shape-picker';
import { clearLastImage, loadLastImage, loadLook, saveLastImage, saveLook } from './persist';
import { Store } from './state';
import { Viewport, ZOOM_STEPS } from './viewport';

const root = document.querySelector<HTMLElement>('[data-app]')!;

if (!Halftone.isSupported()) {
  root.replaceChildren(h('div', { class: 'unsupported' },
    h('h1', {}, 'WebGL2 is not available'),
    h('p', {}, 'Halftone engine renders on the GPU. Try a recent Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.')));
  throw new Error('WebGL2 unavailable');
}

// A share link (#v1&…) wins over the remembered look. The hash is cleared once applied, so a reload
// keeps the user's later edits instead of re-applying the link.
const shared = decodeLook(location.hash);
const store = new Store(shared ?? loadLook());
if (shared) { saveLook(shared); history.replaceState(null, '', location.pathname + location.search); }
store.subscribe(why => { if (why === 'look') saveLook(store.look); });

const viewport = new Viewport(store);
const inspector = new Inspector(store, toast);
const exporter = new ExportDialog(store, () => viewport.engine.maxSize);
const keys = new ShortcutsDialog();

// ── top bar ─────────────────────────────────────────────────
function markEl() { const s = h('span', { class: 'tb-mark' }); s.innerHTML = MARK_SVG; return s; }
const btn = (text: string, title: string, cls = 'tb-btn') => h('button', { type: 'button', class: cls, title, 'aria-label': title }, text) as HTMLButtonElement;
const iconBtn = (icon: string, title: string) => { const b = btn('', title); b.innerHTML = icon; return b; };
const fileName = h('span', { class: 'tb-file' });
const undoBtn = iconBtn(ICONS.undo, `Undo (${MOD}Z)`);
const redoBtn = iconBtn(ICONS.redo, `Redo (${MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})`);
const zoomOut = iconBtn(ICONS.minus, `Zoom out (${MOD}−)`);
const zoomIn = iconBtn(ICONS.plus, `Zoom in (${MOD}+)`);
const zoomSelect = h('select', { class: 'tb-zoom', 'aria-label': 'Zoom' }) as HTMLSelectElement;
const compareBtn = btn('', 'Hold to see the original (\\)', 'tb-btn tb-btn--text');
compareBtn.innerHTML = `${ICONS.compare}<span>Compare</span>`;
const openBtn = btn('Open…', `Open image (${MOD}O)`, 'tb-btn tb-btn--text');
const exportBtn = btn('Export', `Export PNG (${MOD}E)`, 'btn btn--primary btn--small btn--blink');
const helpBtn = iconBtn(ICONS.help, 'Keyboard shortcuts (?)');
const shareBtn = iconBtn(ICONS.link, `Copy share link (⇧${MOD}C)`);
const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: '' }) as HTMLInputElement;

const topbar = h('header', { class: 'tb' },
  h('a', { class: 'tb-brand', href: '/', title: 'About Halftone' }, markEl(), h('span', { class: 'tb-logo' }, 'Halftone')),
  fileName,
  h('div', { class: 'tb-group' }, undoBtn, redoBtn),
  h('div', { class: 'tb-spacer' }),
  h('div', { class: 'tb-group tb-group--zoom' }, zoomOut, h('span', { class: 'select-wrap' }, zoomSelect), zoomIn),
  compareBtn,
  h('div', { class: 'tb-spacer' }),
  helpBtn, shareBtn, openBtn, exportBtn, fileInput);

// ── status bar ──────────────────────────────────────────────
const statusSize = h('span');
const statusCell = h('span', { title: 'Printed at 300 dpi, the image pixel grid gives this screen ruling' });
const statusZoom = h('span');
const credit = h('a', { class: 'sb-credit', href: 'https://interfaz.studio', target: '_blank', rel: 'noopener' }, 'by interfaz.studio');
const statusbar = h('footer', { class: 'sb' }, statusSize, statusCell, h('span', { class: 'tb-spacer' }), statusZoom, credit);

// ── empty state & drop overlay ──────────────────────────────
const samples = [
  { src: '/samples/demo.jpg', name: 'demo' },
];
const emptyOpen = h('button', { type: 'button', class: 'btn btn--primary' }, 'Open image…');
const empty = h('div', { class: 'empty' },
  h('div', { class: 'empty-card' },
    h('p', { class: 'empty-title' }, 'Drop an image to start'),
    h('p', { class: 'empty-sub' }, `or paste with ${MOD}V · JPG, PNG, WebP, AVIF`),
    emptyOpen,
    h('p', { class: 'empty-note' }, 'Everything runs in your browser — images never leave your device.'),
    h('div', { class: 'empty-samples' }, h('span', {}, 'Try a sample'),
      ...samples.map(s => {
        const b = h('button', { type: 'button', class: 'sample', 'aria-label': `Sample: ${s.name}` }, h('img', { src: s.src, alt: '' }));
        b.addEventListener('click', () => openUrl(s.src, s.name));
        return b;
      }))));
const dropOverlay = h('div', { class: 'drop', hidden: '' }, h('p', {}, 'Drop to open'));

const stage = h('div', { class: 'stage' }, viewport.el, empty, dropOverlay);
root.replaceChildren(topbar, h('div', { class: 'work' }, stage, inspector.el), statusbar);

// ── document loading ────────────────────────────────────────
const ACCEPT = /^image\/(png|jpe?g|webp|avif|gif|bmp)$/;

async function openBlob(file: Blob, name: string, remember = true) {
  if (file.type && !ACCEPT.test(file.type)) { toast(`Can't open ${file.type || 'this file'} — use JPG, PNG, WebP or AVIF`, 'error'); return; }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'premultiply' });
  } catch {
    toast('That image could not be decoded', 'error');
    return;
  }
  // Larger than the GPU can hold: scale down to fit and say so
  const max = viewport.engine.maxSize;
  if (Math.max(bmp.width, bmp.height) > max) {
    const k = max / Math.max(bmp.width, bmp.height);
    const resized = await createImageBitmap(bmp, { resizeWidth: Math.floor(bmp.width * k), resizeHeight: Math.floor(bmp.height * k), resizeQuality: 'high', premultiplyAlpha: 'premultiply' });
    toast(`Scaled down from ${bmp.width}×${bmp.height} to fit this GPU (${max}px max)`);
    bmp.close();
    bmp = resized;
  }
  const clean = name.replace(/\.[a-z0-9]+$/i, '') || 'image';
  store.setDoc({ name: clean, source: bmp, width: bmp.width, height: bmp.height });
  if (remember) saveLastImage(file, clean);
}

async function openUrl(src: string, name: string) {
  try {
    const res = await fetch(src);
    await openBlob(await res.blob(), name);
  } catch { toast('Could not load the sample', 'error'); }
}

store.subscribe(why => {
  if (why !== 'doc') return;
  const doc = store.doc;
  empty.hidden = !!doc;
  exportBtn.disabled = compareBtn.disabled = zoomIn.disabled = zoomOut.disabled = zoomSelect.disabled = !doc;
  fileName.textContent = doc ? doc.name : '';
  document.title = doc ? `${doc.name} — Halftone` : 'Halftone — by interfaz.studio';
  inspector.histogram.setSource(doc?.source ?? null);
  inspector.update();
  viewport.setDoc();
  refreshStatus();
});

// ── toolbar / status updates ────────────────────────────────
const pct = (z: number) => `${Math.round(z * 1000) / 10}%`;
function refreshZoom() {
  const z = viewport.zoomLevel;
  const opts = [h('option', { value: 'fit' }, 'Fit'), ...ZOOM_STEPS.filter(s => s >= 0.1).map(s => h('option', { value: String(s) }, pct(s)))] as HTMLOptionElement[];
  const exact = opts.find(o => o.value !== 'fit' && Math.abs(Number(o.value) - z) < 1e-6);
  if (!exact) opts.unshift(h('option', { value: String(z), hidden: '' }, pct(z)) as HTMLOptionElement);
  zoomSelect.replaceChildren(...opts);
  zoomSelect.value = exact?.value ?? String(z);
  statusZoom.textContent = pct(z);
}
function refreshStatus() {
  const doc = store.doc;
  statusSize.textContent = doc ? `${doc.width} × ${doc.height} px` : 'No image';
  const l = store.look;
  if (!doc) statusCell.textContent = '';
  else if (l.mode === 'dither') statusCell.textContent = `${DITHER_INFO[l.dither].name} · ${l.pixel} px pixels${viewport.diffusing ? ' · diffusing…' : ''}`;
  else {
    const lpi = 300 / l.cell;
    statusCell.textContent = `${SHAPE_INFO[l.shape].name} · cell ${l.cell} px ≈ ${lpi < 10 ? lpi.toFixed(1) : Math.round(lpi)} lpi at 300 dpi`;
  }
}
function refreshHistory() {
  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
}
viewport.onChange(() => { refreshZoom(); refreshStatus(); });
store.subscribe(why => { if (why === 'look') refreshStatus(); if (why === 'history') refreshHistory(); });

// ── toolbar actions ─────────────────────────────────────────
undoBtn.addEventListener('click', () => store.undo());
redoBtn.addEventListener('click', () => store.redo());
zoomIn.addEventListener('click', () => viewport.zoomStep(1));
zoomOut.addEventListener('click', () => viewport.zoomStep(-1));
zoomSelect.addEventListener('change', () => {
  if (zoomSelect.value === 'fit') viewport.fit(); else viewport.zoomTo(Number(zoomSelect.value));
  zoomSelect.blur();
});
openBtn.addEventListener('click', () => fileInput.click());
emptyOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) openBlob(f, f.name); fileInput.value = ''; });
exportBtn.addEventListener('click', () => exporter.open());
helpBtn.addEventListener('click', () => keys.toggle());
shareBtn.addEventListener('click', () => shareLink(shareUrl(store.look)));
// A link pasted into this same tab: apply it as one undoable step
addEventListener('hashchange', () => {
  const look = decodeLook(location.hash);
  if (!look) return;
  store.commit(look);
  history.replaceState(null, '', location.pathname + location.search);
  toast('Applied shared settings');
});
// Compare: hold the button (or \) to see the original
compareBtn.addEventListener('pointerdown', () => viewport.setComparing(true));
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => compareBtn.addEventListener(ev, () => viewport.setComparing(false)));

// ── drop & paste ────────────────────────────────────────────
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.hidden = true; } });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; dropOverlay.hidden = true;
  const f = e.dataTransfer?.files[0];
  if (f) openBlob(f, f.name);
});
addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); openBlob(f, f.name && f.name !== 'image.png' ? f.name : 'pasted'); }
});

// ── keyboard ────────────────────────────────────────────────
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (document.querySelector('dialog[open]') && !(mod && k === 'e')) return;   // dialogs handle their own keys
  if (mod) {
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (k === 'y') { e.preventDefault(); store.redo(); return; }
    if (k === 'o') { e.preventDefault(); fileInput.click(); return; }
    if (k === 'e') { e.preventDefault(); exporter.open(); return; }
    if (k === 'c' && e.shiftKey) { e.preventDefault(); shareLink(shareUrl(store.look)); return; }
    if (k === '0') { e.preventDefault(); viewport.fit(); return; }
    if (k === '1') { e.preventDefault(); viewport.actualSize(); return; }
    if (k === '=' || k === '+') { e.preventDefault(); viewport.zoomStep(1); return; }
    if (k === '-') { e.preventDefault(); viewport.zoomStep(-1); return; }
    return;
  }
  if (typing(e.target)) return;
  if (e.key === ' ') { e.preventDefault(); viewport.setSpaceHeld(true); return; }
  if (e.key === '\\') { viewport.setComparing(true); return; }
  if (e.key === '?') { keys.toggle(); return; }
  if (k === 'x' && !store.look.transparent) { store.commit({ ink: store.look.paper, paper: store.look.ink }); return; }
});
addEventListener('keyup', e => {
  if (e.key === ' ') viewport.setSpaceHeld(false);
  if (e.key === '\\') viewport.setComparing(false);
});
addEventListener('blur', () => { viewport.setSpaceHeld(false); viewport.setComparing(false); });

// ── start ───────────────────────────────────────────────────
refreshZoom();
refreshStatus();
refreshHistory();
store.setDoc(null);
const last = await loadLastImage();
if (last) await openBlob(last.file, last.name, false).catch(() => clearLastImage());
if (shared) toast(store.doc ? 'Applied shared settings' : 'Shared settings ready — open an image to apply them');
