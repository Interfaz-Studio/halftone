import { describe, expect, it } from 'vitest';
import { fitUv } from '../src/halftone';

// The visible source window in uv: [offset, offset + scale] on each axis
const window = (fit: 'cover' | 'contain' | 'fill', src: [number, number], out: [number, number]) => {
  const { scale, offset } = fitUv(fit, src, out);
  return [offset[0], offset[0] + scale[0], offset[1], offset[1] + scale[1]];
};

describe('fitUv', () => {
  it('cover crops the sides of a wider source', () => {
    const [x0, x1, y0, y1] = window('cover', [2000, 1000], [1000, 1000]);
    expect([x0, x1]).toEqual([0.25, 0.75]);
    expect([y0, y1]).toEqual([0, 1]);
  });

  it('cover crops top and bottom of a narrower source, never sampling outside it', () => {
    // a 16:9 photo in a 2.14:1 frame, the landing hero's case
    const [x0, x1, y0, y1] = window('cover', [1605, 909], [1198, 559]);
    expect([x0, x1]).toEqual([0, 1]);
    expect(y0).toBeGreaterThan(0);
    expect(y1).toBeLessThan(1);
    expect(y0 + y1).toBeCloseTo(1);
  });

  it('contain letterboxes the other axis', () => {
    expect(window('contain', [2000, 1000], [1000, 1000])).toEqual([0, 1, -0.5, 1.5]);
    expect(window('contain', [1000, 2000], [1000, 1000])).toEqual([-0.5, 1.5, 0, 1]);
  });

  it('fill and matching aspects map the whole source', () => {
    expect(window('fill', [1600, 900], [100, 700])).toEqual([0, 1, 0, 1]);
    expect(window('cover', [1600, 900], [800, 450])).toEqual([0, 1, 0, 1]);
  });
});
