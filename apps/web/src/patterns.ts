// Test sources drawn on a 2D canvas.
import { srgbToLinearInv } from './srgb';

/** Horizontal ramp whose CIE L* rises linearly from 0 (left) to 100 (right). */
export function lightnessRamp(width = 1600, height = 400): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(width, 1);
  for (let x = 0; x < width; x++) {
    const l = x / (width - 1);
    const L = l * 100;
    const y = L > 8 ? Math.pow((L + 16) / 116, 3) : L / (24389 / 27);
    const v = Math.round(srgbToLinearInv(y) * 255);
    img.data.set([v, v, v, 255], x * 4);
  }
  for (let yy = 0; yy < height; yy++) ctx.putImageData(img, 0, yy);
  return c;
}

/** A busier chart: ramp strip, radial falloff, fine checker, type and colour bars. */
export function chart(width = 1600, height = 1000): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(lightnessRamp(width, 160), 0, 0);
  const g = ctx.createRadialGradient(width * 0.28, height * 0.58, 10, width * 0.28, height * 0.58, 300);
  g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(width * 0.28, height * 0.58, 300, 0, Math.PI * 2); ctx.fill();
  for (let y = 0; y < 240; y += 12) for (let x = 0; x < 240; x += 12) {
    if (((x + y) / 12) % 2) { ctx.fillStyle = '#000'; ctx.fillRect(width * 0.58 + x, 230 + y, 12, 12); }
  }
  ctx.fillStyle = '#000'; ctx.font = `bold ${Math.round(width * 0.075)}px Helvetica, Arial, sans-serif`; ctx.textAlign = 'right'; ctx.fillText('HALFTONE', width * 0.96, height * 0.9);
  ['#f00', '#0f0', '#00f', '#ff0', '#0ff', '#f0f', '#888'].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(width * 0.78 + i * 40, 230, 40, 240); });
  return c;
}
