// Inspector controls. Every control has three moments, matching the store:
//   onPreview — live while the user is still adjusting (drag, scrub, typing arrows held)
//   onCommit  — the change is done; becomes one undo step
//   onCancel  — Escape mid-edit; restore what was there
// The UI re-reads values through `update()` whenever the store changes (undo, presets…).

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};

let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

export interface Control { el: HTMLElement; update(): void }

interface NumberOpts {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  /** Decimals shown in the field. */
  decimals: number;
  unit?: string;
  def: number;
  get(): number;
  onPreview(v: number): void;
  onCommit(v: number): void;
  onCancel(): void;
}

/**
 * Label (drag to scrub) · slider · number field.
 * Field: ↑/↓ step (live), ⇧ ×10, ⌥ ×0.1; Enter or leaving the field commits, Esc reverts.
 * Double-click the label to reset.
 */
export function numberControl(o: NumberOpts): Control {
  const id = nextId('num');
  const clamp = (v: number) => Math.min(o.max, Math.max(o.min, v));
  const round = (v: number) => Number(v.toFixed(Math.max(o.decimals, 3)));
  const fmt = (v: number) => v.toFixed(o.decimals);

  const label = h('label', { class: 'ctl-label', for: id, title: `Drag to adjust · double-click to reset${o.hint ? ` · ${o.hint}` : ''}` }, o.label);
  const range = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step / 10), tabindex: '-1', 'aria-hidden': 'true' }) as HTMLInputElement;
  const field = h('input', { id, class: 'ctl-num', type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const unit = h('span', { class: 'ctl-unit' }, o.unit ?? '');
  const el = h('div', { class: 'ctl ctl--number', 'data-ctl': o.label }, label, range, h('span', { class: 'ctl-field' }, field, unit));

  const paint = (v: number) => {
    range.value = String(v);
    range.style.setProperty('--fill', `${((v - o.min) / (o.max - o.min)) * 100}%`);
    if (document.activeElement !== field) field.value = fmt(v);
  };

  // Slider: preview while dragging, commit on release
  range.addEventListener('input', () => { const v = round(Number(range.value)); paint(v); o.onPreview(v); });
  range.addEventListener('change', () => o.onCommit(round(Number(range.value))));

  // Field
  let before = 0;
  field.addEventListener('focus', () => { before = o.get(); field.select(); });
  const fromField = () => {
    const v = parseFloat(field.value.replace(',', '.'));
    return Number.isFinite(v) ? clamp(round(v)) : null;
  };
  field.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const v = clamp(round((fromField() ?? o.get()) + (e.key === 'ArrowUp' ? 1 : -1) * o.step * mult));
      field.value = fmt(v); paint(v); o.onPreview(v);
    } else if (e.key === 'Enter') {
      const v = fromField();
      if (v !== null) { o.onCommit(v); field.value = fmt(v); }
      field.select();
    } else if (e.key === 'Escape') {
      // Arrow steps are previews until Enter / blur, so Escape drops all of them at once
      e.stopPropagation();
      o.onCancel(); field.value = fmt(before); paint(before); field.blur();
    }
  });
  field.addEventListener('blur', () => {
    const v = fromField();
    if (v !== null) o.onCommit(v);   // no-op in the store if nothing changed
    field.value = fmt(o.get());
  });

  // Label scrub: horizontal drag, one step per 2px (⇧ ×10, ⌥ ×0.1)
  let scrub: { x: number; v: number; moved: boolean } | null = null;
  label.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    label.setPointerCapture(e.pointerId);
    scrub = { x: e.clientX, v: o.get(), moved: false };
    document.body.classList.add('is-scrubbing');
  });
  label.addEventListener('pointermove', e => {
    if (!scrub) return;
    const dx = e.clientX - scrub.x;
    if (Math.abs(dx) > 1) scrub.moved = true;
    if (!scrub.moved) return;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const v = clamp(round(scrub.v + Math.round(dx / 2) * o.step * mult));
    paint(v); o.onPreview(v);
  });
  const endScrub = () => {
    if (!scrub) return;
    document.body.classList.remove('is-scrubbing');
    if (scrub.moved) o.onCommit(o.get()); else field.focus();
    scrub = null;
  };
  label.addEventListener('pointerup', endScrub);
  label.addEventListener('pointercancel', endScrub);
  label.addEventListener('dblclick', () => {
    // The first click focused the field; update it too, or leaving it would write the old value back
    paint(o.def); field.value = fmt(o.def); before = o.def;
    o.onCommit(o.def);
  });

  const update = () => paint(o.get());
  update();
  return { el, update };
}

interface ToggleOpts { label: string; get(): boolean; onCommit(v: boolean): void }

export function toggleControl(o: ToggleOpts): Control {
  const id = nextId('tg');
  const input = h('input', { id, type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const el = h('div', { class: 'ctl ctl--toggle' }, h('label', { class: 'ctl-label', for: id }, o.label), h('span', { class: 'ctl-switch' }, input, h('span', { 'aria-hidden': 'true' })));
  input.addEventListener('change', () => o.onCommit(input.checked));
  const update = () => { input.checked = o.get(); };
  update();
  return { el, update };
}

interface ColorOpts {
  label: string;
  get(): string;
  disabled?(): boolean;
  onPreview(v: string): void;
  onCommit(v: string): void;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (v: string) => {
  let x = v.trim().replace('#', '');
  if (x.length === 3) x = [...x].map(c => c + c).join('');
  return `#${x.toUpperCase()}`;
};

/** Swatch (opens the system picker) + hex field. */
export function colorControl(o: ColorOpts): Control {
  const id = nextId('col');
  const picker = h('input', { type: 'color', class: 'ctl-picker', tabindex: '-1', 'aria-hidden': 'true' }) as HTMLInputElement;
  const swatch = h('button', { type: 'button', class: 'ctl-swatch', 'aria-label': `${o.label} colour — open picker` });
  const field = h('input', { id, class: 'ctl-hex', type: 'text', spellcheck: 'false', autocomplete: 'off', maxlength: '7' }) as HTMLInputElement;
  const el = h('div', { class: 'ctl ctl--color' }, h('label', { class: 'ctl-label ctl-label--static', for: id }, o.label), h('span', { class: 'ctl-colorbox' }, swatch, picker, field));

  swatch.addEventListener('click', () => picker.click());
  picker.addEventListener('input', () => { const v = normHex(picker.value); field.value = v; swatch.style.background = v; o.onPreview(v); });
  picker.addEventListener('change', () => o.onCommit(normHex(picker.value)));

  let before = '';
  field.addEventListener('focus', () => { before = o.get(); field.select(); });
  field.addEventListener('input', () => { if (HEX.test(field.value)) { const v = normHex(field.value); swatch.style.background = v; o.onPreview(v); } });
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter') field.blur();
    if (e.key === 'Escape') { e.stopPropagation(); field.value = before; o.onPreview(before); o.onCommit(before); field.blur(); }
  });
  field.addEventListener('blur', () => {
    if (HEX.test(field.value)) o.onCommit(normHex(field.value)); else { field.value = before; o.onPreview(before); o.onCommit(before); }
  });

  const update = () => {
    const v = o.get();
    swatch.style.background = v;
    picker.value = v.length === 7 ? v.toLowerCase() : '#000000';
    if (document.activeElement !== field) field.value = v;
    const off = o.disabled?.() ?? false;
    el.classList.toggle('is-disabled', off);
    field.disabled = off; (swatch as HTMLButtonElement).disabled = off;
  };
  update();
  return { el, update };
}

interface ChipsOpts<T> { label: string; options: { value: T; text: string; title?: string }[]; get(): T; onCommit(v: T): void }

/** A row of quick-pick values (e.g. classic screen angles). */
export function chipsControl<T>(o: ChipsOpts<T>): Control {
  const buttons = o.options.map(opt => {
    const b = h('button', { type: 'button', class: 'chip', ...(opt.title ? { title: opt.title } : {}) }, opt.text);
    b.addEventListener('click', () => o.onCommit(opt.value));
    return { b, opt };
  });
  const el = h('div', { class: 'ctl ctl--chips' }, h('span', { class: 'ctl-label ctl-label--static' }, o.label), h('span', { class: 'chips' }, ...buttons.map(x => x.b)));
  const update = () => { const v = o.get(); buttons.forEach(({ b, opt }) => b.setAttribute('aria-pressed', String(opt.value === v))); };
  update();
  return { el, update };
}
