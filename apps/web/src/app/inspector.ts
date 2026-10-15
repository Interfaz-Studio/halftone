// The right-hand panel: presets, screen, tone and colour.
import { chipsControl, colorControl, h, numberControl, toggleControl, type Control } from './controls';
import { Histogram } from './histogram';
import { ditherPicker, shapePicker } from './shape-picker';
import { addUserPreset, allPresets, matching, removeUserPreset, type Preset } from './presets';
import { DEFAULT_LOOK, TONE_KEYS, type Look, type Store } from './state';

export class Inspector {
  readonly el: HTMLElement;
  readonly histogram = new Histogram();
  private controls: Control[] = [];
  private presetSelect!: HTMLSelectElement;
  private presetState!: HTMLElement;
  private presetDelete!: HTMLButtonElement;
  private paperNote!: HTMLElement;
  private ratioEl!: HTMLElement;
  private dotsGroup!: HTMLElement;
  private crtGroup!: HTMLElement;
  private crtSwitch!: HTMLInputElement;
  private ditherGroup!: HTMLElement;
  private modeButtons: HTMLButtonElement[] = [];
  private paperEl!: HTMLElement;
  private swapBtn!: HTMLElement;

  constructor(private store: Store, private toast: (msg: string) => void) {
    this.el = h('aside', { class: 'insp', 'aria-label': 'Settings' });
    this.build();
    store.subscribe(why => { if (why === 'look' || why === 'history') this.update(); });
  }

  private section(title: string, ...children: (Node | string)[]) {
    const sec = h('section', { class: 'insp-sec' }, h('h2', { class: 'insp-title' }, h('span', {}, `[ ${title} ]`)), ...children);
    this.el.append(sec);
    return sec;
  }

  private num(key: 'cell' | 'angle' | 'softness' | 'brightness' | 'contrast' | 'gamma' | 'ratio' | 'pixel' | 'scanlines' | 'scanlineSpacing' | 'rgbShift', opts: { label: string; min: number; max: number; step: number; decimals: number; unit?: string; hint?: string }) {
    const s = this.store;
    const c = numberControl({
      ...opts,
      def: DEFAULT_LOOK[key],
      get: () => s.look[key],
      onPreview: v => s.preview({ [key]: v }),
      onCommit: v => s.commit({ [key]: v }),
      onCancel: () => s.cancel(),
    });
    this.controls.push(c);
    return c.el;
  }

  private build() {
    const s = this.store;

    // ── presets ────────────────────────────────────────────
    this.presetSelect = h('select', { class: 'preset-select', 'aria-label': 'Preset' }) as HTMLSelectElement;
    this.presetState = h('span', { class: 'preset-state' });
    const save = h('button', { type: 'button', class: 'icon-btn', title: 'Save current screen & colours as a preset', 'aria-label': 'Save preset' }, '+') as HTMLButtonElement;
    this.presetDelete = h('button', { type: 'button', class: 'icon-btn', title: 'Delete this preset', 'aria-label': 'Delete preset' }, '−') as HTMLButtonElement;
    const nameField = h('input', { class: 'preset-name', type: 'text', placeholder: 'Preset name', maxlength: '40', 'aria-label': 'Preset name' }) as HTMLInputElement;
    const saveForm = h('form', { class: 'preset-save', hidden: '' }, nameField, h('button', { type: 'submit', class: 'btn btn--small' }, 'Save'));

    this.presetSelect.addEventListener('change', () => {
      const p = allPresets().find(x => x.id === this.presetSelect.value);
      if (p) s.commit({ ...p.look });
    });
    save.addEventListener('click', () => { saveForm.hidden = !saveForm.hidden; if (!saveForm.hidden) { nameField.value = ''; nameField.focus(); } });
    nameField.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); saveForm.hidden = true; } });
    saveForm.addEventListener('submit', e => {
      e.preventDefault();
      const name = nameField.value.trim();
      if (!name) return;
      addUserPreset(name, s.look);
      saveForm.hidden = true;
      this.update();
      this.toast(`Saved preset “${name}”`);
    });
    this.presetDelete.addEventListener('click', () => {
      const p = matching(s.look);
      if (!p || p.builtin) return;
      removeUserPreset(p.id);
      this.update();
      this.toast(`Deleted preset “${p.name}”`);
    });

    this.section('Preset',
      h('div', { class: 'preset-row' }, h('span', { class: 'select-wrap' }, this.presetSelect), save, this.presetDelete),
      this.presetState,
      saveForm);

    // ── screen ─────────────────────────────────────────────
    const angleChips = chipsControl({
      label: '',
      options: [0, 15, 45, 75].map(v => ({ value: v, text: `${v}°`, title: `Classic screen angle ${v}°` })),
      get: () => s.look.angle,
      onCommit: v => s.commit({ angle: v }),
    });
    this.controls.push(angleChips);
    const picker = shapePicker(s);
    this.controls.push(picker);
    // Shape-specific settings sit right under the picker and appear only for that shape
    this.ratioEl = this.num('ratio', { label: 'Ratio', min: 0.2, max: 1, step: 0.01, decimals: 2, hint: 'dot height ÷ width' });
    // Each mode keeps its own settings; switching shows only that mode's controls
    this.dotsGroup = h('div', { class: 'insp-group' },
      picker.el,
      this.ratioEl,
      this.num('cell', { label: 'Cell', min: 2, max: 64, step: 0.5, decimals: 1, unit: 'px', hint: 'distance between dot centres, in image pixels' }),
      this.num('angle', { label: 'Angle', min: -90, max: 90, step: 1, decimals: 1, unit: '°' }),
      angleChips.el,
      this.num('softness', { label: 'Edge', min: 1, max: 8, step: 0.1, decimals: 1, unit: 'px', hint: '1 = crisp' }));
    const dPicker = ditherPicker(s);
    this.controls.push(dPicker);
    this.ditherGroup = h('div', { class: 'insp-group' },
      dPicker.el,
      this.num('pixel', { label: 'Pixel', min: 1, max: 16, step: 1, decimals: 0, unit: 'px', hint: 'size of one dither pixel, in image pixels' }));

    const modes = [['dots', 'Dots'], ['dither', 'Dither']] as const;
    this.modeButtons = modes.map(([value, text]) => {
      const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'data-mode': value }, text) as HTMLButtonElement;
      b.addEventListener('click', () => s.commit({ mode: value }));
      return b;
    });
    const modeSeg = h('div', { class: 'seg seg--mode', role: 'radiogroup', 'aria-label': 'Screen type' }, ...this.modeButtons);
    modeSeg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = s.look.mode === 'dots' ? 'dither' : 'dots';
      s.commit({ mode: next });
      this.modeButtons.find(b => b.dataset.mode === next)!.focus();
    });
    this.section('Screen', modeSeg, this.dotsGroup, this.ditherGroup);

    // ── tone ───────────────────────────────────────────────
    const invert = toggleControl({ label: 'Invert', get: () => s.look.invert, onCommit: v => s.commit({ invert: v }) });
    this.controls.push(invert);
    const resetTone = h('button', { type: 'button', class: 'link-btn' }, 'Reset');
    resetTone.addEventListener('click', () => s.commit(Object.fromEntries(TONE_KEYS.map(k => [k, DEFAULT_LOOK[k]])) as Partial<Look>));
    const toneSec = this.section('Tone',
      this.histogram.el,
      this.num('brightness', { label: 'Brightness', min: -1, max: 1, step: 0.01, decimals: 2 }),
      this.num('contrast', { label: 'Contrast', min: -1, max: 1, step: 0.01, decimals: 2 }),
      this.num('gamma', { label: 'Gamma', min: 0.2, max: 3, step: 0.01, decimals: 2, hint: 'above 1 lifts the midtones' }),
      invert.el);
    toneSec.querySelector('.insp-title')!.append(resetTone);

    // ── colour ─────────────────────────────────────────────
    const ink = colorControl({ label: 'Ink', get: () => s.look.ink, onPreview: v => s.preview({ ink: v }), onCommit: v => s.commit({ ink: v }) });
    const paper = colorControl({ label: 'Paper', get: () => s.look.paper, onPreview: v => s.preview({ paper: v }), onCommit: v => s.commit({ paper: v }) });
    const transparent = toggleControl({ label: 'Ink only', get: () => s.look.transparent, onCommit: v => s.commit({ transparent: v }) });
    this.controls.push(ink, paper, transparent);
    const swap = h('button', { type: 'button', class: 'link-btn', title: 'Swap ink and paper (X)' }, 'Swap');
    swap.addEventListener('click', () => s.commit({ ink: s.look.paper, paper: s.look.ink }));
    this.paperNote = h('p', { class: 'insp-note' }, 'Single colour on a transparent background — exports as a cut-out PNG.');
    this.paperEl = paper.el;
    this.swapBtn = swap;
    const colorSec = this.section('Colour', ink.el, paper.el, transparent.el, this.paperNote);
    colorSec.querySelector('.insp-title')!.append(swap);

    // ── CRT ────────────────────────────────────────────────
    // Off: one row. The switch keeps the values, so turning it back on restores the look.
    this.crtSwitch = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'CRT effects' }) as HTMLInputElement;
    this.crtSwitch.addEventListener('change', () => s.commit({ crt: this.crtSwitch.checked }));
    this.crtGroup = h('div', { class: 'insp-group' },
      this.num('scanlines', { label: 'Scanlines', min: 0, max: 1, step: 0.01, decimals: 2, hint: 'darkness of each line' }),
      this.num('scanlineSpacing', { label: 'Spacing', min: 2, max: 16, step: 0.5, decimals: 1, unit: 'px', hint: 'distance between scanlines, in image pixels' }),
      this.num('rgbShift', { label: 'RGB shift', min: 0, max: 10, step: 0.25, decimals: 2, unit: 'px', hint: 'red and blue offset sideways' }));
    const crtSec = this.section('CRT', this.crtGroup);
    crtSec.querySelector('.insp-title')!.append(h('span', { class: 'ctl-switch insp-title-switch' }, this.crtSwitch, h('span', { 'aria-hidden': 'true' })));

    this.update();
  }

  update(): void {
    this.controls.forEach(c => c.update());
    this.ratioEl.hidden = this.store.look.shape !== 'ellipse';
    this.crtSwitch.checked = this.store.look.crt;
    this.crtGroup.hidden = !this.store.look.crt;
    const dither = this.store.look.mode === 'dither';
    this.dotsGroup.hidden = dither;
    this.ditherGroup.hidden = !dither;
    for (const b of this.modeButtons) {
      const on = b.dataset.mode === this.store.look.mode;
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const inkOnly = this.store.look.transparent;
    this.paperNote.hidden = !inkOnly;
    this.paperEl.hidden = inkOnly;
    this.swapBtn.hidden = inkOnly;
    this.histogram.draw(this.store.look);

    // Preset list, current match and "modified" state
    const presets = allPresets();
    const match = matching(this.store.look);
    const opt = (p: Preset) => { const o = h('option', { value: p.id }, p.name) as HTMLOptionElement; return o; };
    const groups = [
      h('optgroup', { label: 'Built-in' }, ...presets.filter(p => p.builtin).map(opt)),
      ...(presets.some(p => !p.builtin) ? [h('optgroup', { label: 'Yours' }, ...presets.filter(p => !p.builtin).map(opt))] : []),
    ];
    const custom = h('option', { value: '', disabled: '' }, 'Custom') as HTMLOptionElement;
    this.presetSelect.replaceChildren(...(match ? [] : [custom]), ...groups);
    this.presetSelect.value = match?.id ?? '';
    this.presetState.textContent = match ? '' : 'Screen or colours changed — save to keep as a preset';
    this.presetDelete.hidden = !match || match.builtin;
  }
}
