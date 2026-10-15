// Export dialog, keyboard-shortcut sheet and toasts.
import { exportImage } from '@interfaz/halftone';
import { h } from './controls';
import { toEngine, type Store } from './state';

// ── toast ───────────────────────────────────────────────────
const toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
document.body.append(toasts);
export function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  const t = h('div', { class: `toast toast--${kind}` }, msg);
  toasts.append(t);
  setTimeout(() => t.classList.add('is-out'), kind === 'error' ? 5000 : 2600);
  setTimeout(() => t.remove(), kind === 'error' ? 5400 : 3000);
}

// ── export ──────────────────────────────────────────────────
const PRINT_DPI = 300;

export class ExportDialog {
  readonly el: HTMLDialogElement;
  private scale = 1;
  private sizeOut: HTMLElement;
  private printOut: HTMLElement;
  private nameField: HTMLInputElement;
  private go: HTMLButtonElement;
  private status: HTMLElement;
  private scaleButtons: HTMLButtonElement[];
  private busy = false;

  constructor(private store: Store, private maxSize: () => number) {
    this.scaleButtons = [1, 2, 3, 4].map(n => {
      const b = h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(n === 1) }, `${n}×`) as HTMLButtonElement;
      b.addEventListener('click', () => { this.scale = n; this.refresh(); });
      return b;
    });
    this.sizeOut = h('strong');
    this.printOut = h('span', { class: 'muted' });
    this.nameField = h('input', { type: 'text', class: 'text-field', spellcheck: 'false', 'aria-label': 'File name' }) as HTMLInputElement;
    this.go = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Export PNG') as HTMLButtonElement;
    this.status = h('p', { class: 'dialog-status', role: 'status' });
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    cancel.addEventListener('click', () => this.el.close());

    const form = h('form', { method: 'dialog', class: 'dialog-body' },
      h('h2', { class: 'dialog-title' }, 'Export'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), h('div', { class: 'seg' }, ...this.scaleButtons)),
      h('p', { class: 'field-note' }, this.sizeOut, ' ', this.printOut),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'File name'), h('span', { class: 'name-row' }, this.nameField, h('span', { class: 'muted' }, '.png'))),
      this.status,
      h('div', { class: 'dialog-actions' }, cancel, this.go));
    form.addEventListener('submit', e => { e.preventDefault(); this.run(); });
    this.el = h('dialog', { class: 'dialog', 'aria-label': 'Export' }, form) as HTMLDialogElement;
    this.el.addEventListener('cancel', e => { if (this.busy) e.preventDefault(); });
    document.body.append(this.el);
  }

  open(): void {
    const doc = this.store.doc;
    if (!doc) return;
    this.nameField.value = `${doc.name}-halftone`;
    this.status.textContent = '';
    this.refresh();
    this.el.showModal();
    this.go.focus();
  }

  private refresh() {
    const doc = this.store.doc!;
    this.scaleButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === this.scale)));
    const w = Math.round(doc.width * this.scale), hh = Math.round(doc.height * this.scale);
    this.sizeOut.textContent = `${w} × ${hh} px`;
    const cm = (px: number) => ((px / PRINT_DPI) * 2.54).toFixed(1);
    this.printOut.textContent = `· ${cm(w)} × ${cm(hh)} cm at ${PRINT_DPI} dpi`;
    const tooBig = Math.max(w, hh) > this.maxSize();
    this.go.disabled = tooBig;
    if (tooBig) this.status.textContent = `Too large for this GPU (max ${this.maxSize()} px per side) — choose a smaller size.`;
    else if (!this.busy) this.status.textContent = '';
  }

  private async run() {
    const doc = this.store.doc;
    if (!doc || this.busy) return;
    this.busy = true;
    this.go.disabled = true;
    this.status.textContent = 'Rendering…';
    await new Promise(r => requestAnimationFrame(() => r(null)));   // let the status paint
    try {
      const blob = await exportImage(doc.source, toEngine(this.store.look), { scale: this.scale });
      const name = (this.nameField.value.trim() || `${doc.name}-halftone`).replace(/[\\/:*?"<>|]+/g, '-');
      const a = h('a', { href: URL.createObjectURL(blob), download: `${name}.png` }) as HTMLAnchorElement;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.el.close();
      toast(`Exported ${name}.png · ${(blob.size / 1e6).toFixed(1)} MB`);
    } catch (e) {
      this.status.textContent = `Export failed: ${(e as Error).message}`;
    } finally {
      this.busy = false;
      this.go.disabled = false;
    }
  }
}

// ── share ───────────────────────────────────────────────────
/** Copy a share link; if the clipboard is unavailable, show it in a dialog to copy by hand. */
export async function shareLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — it carries the settings, not your image');
    return;
  } catch { /* no clipboard permission (e.g. insecure context): fall back */ }
  const field = h('input', { type: 'text', class: 'text-field', readonly: '', 'aria-label': 'Share link' }) as HTMLInputElement;
  field.value = url;
  const close = h('button', { type: 'button', class: 'btn' }, 'Close');
  const d = h('dialog', { class: 'dialog', 'aria-label': 'Share link' },
    h('div', { class: 'dialog-body' },
      h('h2', { class: 'dialog-title' }, 'Share'),
      h('p', { class: 'field-note' }, 'Copy this link. It carries the settings, not your image.'),
      field,
      h('div', { class: 'dialog-actions' }, close))) as HTMLDialogElement;
  close.addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  field.select();
}

// ── shortcuts sheet ─────────────────────────────────────────
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = mac ? '⌘' : 'Ctrl+';

export const SHORTCUTS: [string, string][] = [
  [`${MOD}O`, 'Open image'],
  [`${MOD}V`, 'Paste image'],
  [`${MOD}E`, 'Export'],
  [`⇧${MOD}C`, 'Copy share link'],
  [`${MOD}Z`, 'Undo'],
  [mac ? '⇧⌘Z' : 'Ctrl+Y', 'Redo'],
  [`${MOD}0`, 'Fit to screen'],
  [`${MOD}1`, 'Actual pixels (100%)'],
  [`${MOD}+ / ${MOD}−`, 'Zoom in / out'],
  ['Scroll · Space + drag', 'Pan'],
  [`Pinch · ${MOD}scroll`, 'Zoom at pointer'],
  ['Hold \\', 'Compare with original'],
  ['X', 'Swap ink and paper'],
  ['Drag a label', 'Scrub a value (⇧ ×10, ⌥ fine)'],
  ['↑ / ↓ in a field', 'Step a value (⇧ ×10, ⌥ fine)'],
  ['Double-click a label', 'Reset to default'],
  ['?', 'Show shortcuts'],
];

export class ShortcutsDialog {
  readonly el: HTMLDialogElement;
  constructor() {
    const close = h('button', { type: 'button', class: 'btn' }, 'Close');
    close.addEventListener('click', () => this.el.close());
    this.el = h('dialog', { class: 'dialog dialog--keys', 'aria-label': 'Keyboard shortcuts' },
      h('div', { class: 'dialog-body' },
        h('h2', { class: 'dialog-title' }, 'Shortcuts'),
        h('dl', { class: 'keys' }, ...SHORTCUTS.flatMap(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)])),
        h('div', { class: 'dialog-actions' }, close))) as HTMLDialogElement;
    document.body.append(this.el);
  }
  toggle() { if (this.el.open) this.el.close(); else this.el.showModal(); }
}
