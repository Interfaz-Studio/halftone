/** linear → sRGB encoded (used to build test charts). */
export const srgbToLinearInv = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** sRGB encoded → linear. */
export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const lightness = (y: number) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y) / 100;
export const lightnessToY = (l: number) => { const L = l * 100; return L > 8 ? Math.pow((L + 16) / 116, 3) : L / (24389 / 27); };
