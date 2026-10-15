import { describe, expect, it } from 'vitest';
import { decodeLook, encodeLook } from '../src/app/share';
import { BUILTIN } from '../src/app/presets';
import { DEFAULT_LOOK, type Look } from '../src/app/state';

describe('share links', () => {
  it('the default look encodes to just the version', () => {
    expect(encodeLook({ ...DEFAULT_LOOK })).toBe('#v1');
  });

  it('round-trips every built-in preset exactly', () => {
    for (const p of BUILTIN) {
      const look: Look = { ...DEFAULT_LOOK, ...p.look, brightness: 0.12, gamma: 1.35, invert: true };
      expect(decodeLook(encodeLook(look))).toEqual(look);
    }
  });

  it('is short and readable', () => {
    const link = encodeLook({ ...DEFAULT_LOOK, shape: 'line', cell: 6, angle: 30, ink: '#FFFFFF', paper: '#1F4E8C' });
    expect(link).toBe('#v1&s=line&c=6&a=30&ink=FFFFFF&paper=1F4E8C');
  });

  it('ignores anything that is not a share link', () => {
    for (const h of ['', '#', '#top', '#v2&c=4', 'c=4']) expect(decodeLook(h)).toBeNull();
  });

  it('survives hand-edited and hostile values', () => {
    const l = decodeLook('#v1&c=9999&a=-500&s=star&m=nope&ink=<script>&paper=12&px=3.6&g=NaN&b=&unknown=1&inv=0&sl=7')!;
    expect(l.cell).toBe(64);
    expect(l.angle).toBe(-90);
    expect(l.shape).toBe(DEFAULT_LOOK.shape);
    expect(l.mode).toBe(DEFAULT_LOOK.mode);
    expect(l.ink).toBe(DEFAULT_LOOK.ink);
    expect(l.paper).toBe(DEFAULT_LOOK.paper);
    expect(l.pixel).toBe(4);
    expect(l.gamma).toBe(DEFAULT_LOOK.gamma);
    expect(l.brightness).toBe(DEFAULT_LOOK.brightness);
    expect(l.invert).toBe(false);
    expect(l.scanlines).toBe(DEFAULT_LOOK.scanlines);   // 7 is out of range → default
  });

  it('a malformed escape is skipped, not fatal', () => {
    expect(decodeLook('#v1&s=%E0&c=5')).toEqual({ ...DEFAULT_LOOK, cell: 5 });
  });

  it('a link made before a setting existed keeps that setting at its default', () => {
    expect(decodeLook('#v1&c=12')).toEqual({ ...DEFAULT_LOOK, cell: 12 });
  });
});
