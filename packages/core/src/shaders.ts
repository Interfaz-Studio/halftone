/**
 * GLSL ES 3.00 sources.
 *
 * Pipeline per canvas pixel:
 *  0. Map it to output (image) pixels through the view — zoom and pan for interactive use.
 *  1. Find the screen cell the pixel falls in (grid rotated by `uAngle` around `uOrigin`).
 *  2. For that cell and its 8 neighbours: average the source over the cell (mip level `uLod`),
 *     turn it into ink coverage (tone curve below) and coverage into a dot radius (LUT).
 *  3. Supersample the pixel: signed distance to the nearest dot edge at each subsample → ink.
 *  4. Mix paper and ink in linear light, encode to sRGB, premultiply.
 *
 * Tone curve: the source's CIE lightness (after brightness / contrast / gamma / invert) is mapped
 * onto the lightness range spanned by the two inks, and coverage is solved so that paper and
 * ink mixed at viewing distance hit that lightness. A grey ramp therefore stays a perceptually
 * even ramp for any pair of inks — light-on-dark included, with no manual inversion.
 */

export const VERTEX: string = /* glsl */ `#version 300 es
// One oversized triangle covers the viewport. Drawn from a real vertex buffer at attribute 0:
// drawing with no enabled attribute array makes Firefox on macOS emulate it, slowly.
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAGMENT: string = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSource;    // sRGB texture (sampled as linear), premultiplied alpha, mipmapped
uniform sampler2D uLut;       // R32F, uLutSize × 1: coverage → radius (round) or spot threshold (other shapes)

uniform vec2  uCanvas;        // drawing buffer size in pixels
uniform vec2  uOutput;        // output (image) size in pixels
uniform float uViewScale;     // canvas pixels per output pixel (zoom)
uniform vec2  uViewOrigin;    // output pixel at the canvas' top-left corner
uniform bool  uViewSnap;      // zoomed in: show each output pixel as a flat block (pixel inspection)
uniform float uTexelsPerPx;   // source texels per output pixel
uniform vec2  uUvScale;       // output pixel → source uv: uv = p / uOutput * uUvScale + uUvOffset
uniform vec2  uUvOffset;
uniform bool  uClampEdges;    // false: cells centred outside the image get no ink (contain)
uniform vec2  uOrigin;        // grid origin in output pixels
uniform float uCell;          // cell pitch in output pixels
uniform float uAngle;         // grid angle, radians
uniform float uLod;           // mip level that averages one cell of source
uniform float uLutSize;
uniform float uSoftness;      // edge width in output pixels, 1 = crisp
uniform int   uSamples;       // supersampling grid per axis, 1–8
uniform int   uShape;         // SHAPE_ID in shapes.ts; 0 = round
uniform int   uMode;          // 0 dots · 1 ordered dither (threshold map) · 2 error-diffusion mask
uniform float uPixel;         // dither pixel size in output pixels
uniform float uLodPixel;      // mip level that averages one dither pixel of source
uniform sampler2D uThresh;    // R32F uThreshN², tiled threshold map
uniform int   uThreshN;
uniform sampler2D uMask;      // R8, one texel per dither pixel
uniform ivec2 uMaskSize;
uniform float uRatio;         // ellipse height / width

uniform float uBrightness;    // [-1, 1]
uniform float uContrast;      // [-1, 1]
uniform float uGamma;         // > 0, 1 = neutral
uniform bool  uInvert;

uniform vec4  uInk;           // linear rgb + alpha
uniform vec4  uPaper;
uniform float uInkY;          // relative luminance of ink / paper
uniform float uPaperY;
uniform float uLightMin;      // CIE L* (0–1) of the darker / lighter of ink and paper
uniform float uLightMax;

out vec4 outColor;

float lightness(float y) {
  return (y > 216.0 / 24389.0 ? 116.0 * pow(y, 1.0 / 3.0) - 16.0 : (24389.0 / 27.0) * y) / 100.0;
}
float lightnessToY(float l) {
  float L = l * 100.0;
  return L > 8.0 ? pow((L + 16.0) / 116.0, 3.0) : L / (24389.0 / 27.0);
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Ink coverage [0, 1] of the source around output pixel p, averaged over mip level lod
float coverageAt(vec2 p, float lod) {
  vec2 uv = p / uOutput * uUvScale + uUvOffset;
  if (!uClampEdges && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))) return 0.0;
  vec4 s = textureLod(uSource, clamp(uv, 0.0, 1.0), lod);
  if (s.a <= 0.0) return 0.0;
  vec3 rgb = s.rgb / s.a;

  float l = lightness(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  l += uBrightness;
  float k = clamp(uContrast, -0.999, 0.999);
  l = (l - 0.5) * ((1.0 + k) / (1.0 - k)) + 0.5;
  l = pow(clamp(l, 0.0, 1.0), 1.0 / uGamma);
  if (uInvert) l = 1.0 - l;

  float c;
  float span = uInkY - uPaperY;
  if (abs(span) < 1e-5) {
    c = 1.0 - l;   // inks of equal luminance: tone can't be reproduced, fall back to "dark = ink"
  } else {
    float y = lightnessToY(mix(uLightMin, uLightMax, l));
    c = clamp((y - uPaperY) / span, 0.0, 1.0);
  }
  return c * s.a;   // transparent source shows paper
}

// Spot functions — mirror of spot() / spotSlope() in shapes.ts. l: cell-local, [-0.5, 0.5]².
float spotValue(vec2 l) {
  vec2 a = abs(l) * 2.0;
  if (uShape == 1) return a.x + a.y <= 1.0 ? dot(a, a) - 1.0 : 1.0 - dot(1.0 - a, 1.0 - a);
  if (uShape == 2) return max(a.x, a.y);
  if (uShape == 3) return a.x + a.y;
  if (uShape == 4) return length(vec2(a.x, a.y / uRatio));
  if (uShape == 5) return a.y;
  return min(a.x, a.y);   // 6: cross
}
float spotSlope(vec2 l) {
  vec2 a = abs(l) * 2.0;
  if (uShape == 1) return a.x + a.y <= 1.0 ? 4.0 * length(a) : 4.0 * length(1.0 - a);
  if (uShape == 3) return 2.0 * 1.41421356;
  if (uShape == 4) {
    float s = length(vec2(a.x, a.y / uRatio));
    return s > 0.0 ? 2.0 * length(vec2(a.x, a.y / (uRatio * uRatio))) / s : 2.0;
  }
  return 2.0;   // square, line, cross
}

float lutAt(float c) {
  float x = c * (uLutSize - 1.0);
  int i = int(min(floor(x), uLutSize - 2.0));
  float a = texelFetch(uLut, ivec2(i, 0), 0).r;
  float b = texelFetch(uLut, ivec2(i + 1, 0), 0).r;
  return mix(a, b, x - float(i));
}

// Ink (0 or 1) of the dither pixel containing output pixel q
float ditherInk(vec2 q) {
  vec2 b = floor(q / uPixel);
  if (uMode == 2) {
    ivec2 bi = ivec2(b);
    if (bi.x < 0 || bi.y < 0 || bi.x >= uMaskSize.x || bi.y >= uMaskSize.y) return 0.0;
    return texelFetch(uMask, bi, 0).r > 0.5 ? 1.0 : 0.0;
  }
  float c = coverageAt((b + 0.5) * uPixel, uLodPixel);
  ivec2 t = ivec2(mod(b, float(uThreshN)));
  return c > texelFetch(uThresh, t, 0).r ? 1.0 : 0.0;
}

void main() {
  // Canvas pixel → output pixel. With snapping (whole-number zoom ≥ 1) every output pixel is shown
  // as one flat block, exactly as it will export. Otherwise each canvas pixel is filtered over the
  // part of the output it covers — at fractional zooms, uneven blocks would read as jagged dots.
  vec2 fc = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);   // top-left origin, like the image
  vec2 p;
  float pxSize;   // output pixels covered by one canvas pixel, along each axis
  if (uViewSnap) {
    p = floor(fc / uViewScale + uViewOrigin) + 0.5;
    pxSize = 1.0;
  } else {
    p = fc / uViewScale + uViewOrigin;
    pxSize = 1.0 / uViewScale;
  }
  if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, uOutput))) { outColor = vec4(0.0); return; }

  float ink = 0.0;

  if (uMode != 0) {
    // Dither: square pixels, axis-aligned. Only when zoomed out so far that a dither pixel is
    // smaller than a screen pixel can't the pattern be shown; fade to its average tone there.
    // (At 100 % and in exports pxSize is 1 and uPixel ≥ 1, so the pattern is always drawn.)
    float show = smoothstep(0.5, 1.0, uPixel / pxSize);
    if (show < 1.0) ink = coverageAt(p, max(uLodPixel, log2(max(pxSize * uTexelsPerPx, 1.0)))) * (1.0 - show);
    if (show > 0.0) {
      int n = min(uSamples, 4);   // dither edges are axis-aligned; a few subsamples suffice
      float step = 1.0 / float(n), acc = 0.0;
      for (int sy = 0; sy < 4; sy++) {
        if (sy >= n) break;
        for (int sx = 0; sx < 4; sx++) {
          if (sx >= n) break;
          acc += ditherInk(p + ((vec2(float(sx), float(sy)) + 0.5) * step - 0.5) * pxSize);
        }
      }
      ink += acc / float(n * n) * show;
    }
    vec4 inkP = vec4(uInk.rgb * uInk.a, uInk.a);
    vec4 paperP = vec4(uPaper.rgb * uPaper.a, uPaper.a);
    vec4 c = mix(paperP, inkP, ink);
    vec3 rgb = c.a > 0.0 ? linearToSrgb(c.rgb / c.a) : vec3(0.0);
    outColor = vec4(rgb * c.a, c.a);
    return;
  }

  // Zoomed out until a cell is under ~2 screen pixels, dots can't be resolved and alias into
  // moiré; fade to the tone they average to — what the eye sees at that distance anyway.
  // Never in exports: there pxSize is 1 and cells are ≥ 2px, so dots are always fully drawn.
  float dots = smoothstep(1.0, 2.0, uCell / pxSize);

  if (dots < 1.0) {
    float lod = max(uLod, log2(max(pxSize * uTexelsPerPx, 1.0)));
    ink = coverageAt(p, lod) * (1.0 - dots);
  }

  if (dots > 0.0) {
    float ca = cos(uAngle), sa = sin(uAngle);
    mat2 toGrid = mat2(ca, -sa, sa, ca);    // rotate by -angle
    mat2 fromGrid = mat2(ca, sa, -sa, ca);  // rotate by +angle

    vec2 q = toGrid * (p - uOrigin) / uCell;   // grid space: one unit per cell, dots on integers
    vec2 k = floor(q + 0.5);
    vec2 f = q - k;

    // Coverage of this cell and its 8 neighbours, and what it means for each dot: a radius (round
    // dots can reach into a lighter neighbour) or a spot threshold. Texture reads happen once
    // per cell here, not per subsample.
    float cov[9];
    float lut[9];
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        int t = (j + 1) * 3 + (i + 1);
        cov[t] = coverageAt(uOrigin + fromGrid * ((k + vec2(float(i), float(j))) * uCell), uLod);
        lut[t] = cov[t] > 0.0 ? lutAt(cov[t]) : -1.0;
      }
    }

    // Antialiasing by supersampling: an n×n grid of subsamples over the pixel's footprint, each
    // with a ramp n times narrower. A single distance-based ramp exaggerates features near pixel
    // size (tiny dots print too dark, tiny gaps too light); subsamples keep the ink area right.
    int n = uSamples;
    float step = 1.0 / float(n);
    // Each subsample's edge ramp: one subsample wide (crisp), widened by any extra softness
    float rampPx = step * pxSize + max(uSoftness - 1.0, 0.0);   // output pixels
    float ramp = uCell / rampPx;                                 // cell units → ramp widths
    float dotInk = 0.0;
    for (int sy = 0; sy < 8; sy++) {
      if (sy >= n) break;
      for (int sx = 0; sx < 8; sx++) {
        if (sx >= n) break;
        vec2 sp = ((vec2(float(sx), float(sy)) + 0.5) * step - 0.5) * pxSize;   // output pixels
        vec2 g = f + toGrid * sp / uCell;
        if (uShape == 0) {
          // Round: union of circles over the neighbourhood
          float d = 1e9;
          for (int t = 0; t < 9; t++) {
            if (lut[t] < 0.0) continue;
            vec2 o = vec2(float(t % 3 - 1), float(t / 3 - 1));
            d = min(d, length(g - o) - lut[t]);
          }
          dotInk += clamp(0.5 - d * ramp, 0.0, 1.0);
        } else {
          // Spot shapes: each cell's ink lies inside its own cell, so the antialiased contributions
          // of the cells around the subsample can simply be added. (Looking at only the subsample's
          // own cell cuts every edge's ramp off at the cell border, which makes thin gaps between
          // cells read too wide — at 45° that lightened the shadows by up to 13 L*.)
          float sum = 0.0;
          for (int t = 0; t < 9; t++) {
            if (cov[t] <= 0.0) continue;
            vec2 l = g - vec2(float(t % 3 - 1), float(t / 3 - 1));
            // Inside-the-cell mask, antialiased: signed distance to the cell's border
            float box = clamp(0.5 - (max(abs(l.x), abs(l.y)) - 0.5) * ramp, 0.0, 1.0);
            if (box <= 0.0) continue;
            float inked = 1.0;
            if (cov[t] < 1.0) {
              // Past the border the spot value keeps rising at the border's slope, so an edge's
              // ramp continues smoothly into the neighbour (sub-pixel gaps stay the right width).
              // The box mask then cuts only ink that really reaches the border.
              vec2 lc = clamp(l, -0.5, 0.5);
              float slope = spotSlope(lc);
              float v = spotValue(lc) + slope * length(l - lc);
              float w = max(slope * rampPx / uCell, 1e-6);
              inked = clamp((lut[t] - v) / w + 0.5, 0.0, 1.0);
            }
            sum += min(inked, box);
          }
          dotInk += min(sum, 1.0);
        }
      }
    }
    ink += dotInk / float(n * n) * dots;
  }

  vec4 inkP = vec4(uInk.rgb * uInk.a, uInk.a);
  vec4 paperP = vec4(uPaper.rgb * uPaper.a, uPaper.a);
  vec4 c = mix(paperP, inkP, ink);
  vec3 rgb = c.a > 0.0 ? linearToSrgb(c.rgb / c.a) : vec3(0.0);
  outColor = vec4(rgb * c.a, c.a);
}`;

/**
 * Post pass — CRT effects over the finished halftone (the main pass rendered into a texture).
 * Runs only when an effect is on. Works in canvas pixels; effect sizes arrive in output pixels
 * and are converted with the view scale, so a preview and its export look the same.
 *  · RGB shift: red sampled from the left, blue from the right — the colour fringing of a CRT's
 *    misconverged guns.
 *  · Scanlines: a smooth (cosine) dark band every uScanSpacing output pixels, applied in linear
 *    light. Zoomed out until bands are under ~2 screen pixels, they'd alias into moiré, so they
 *    fade to their average darkening instead.
 */
export const POST: string = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uImage;     // main pass: sRGB-encoded, premultiplied
uniform vec2  uCanvas;
uniform float uViewScale;     // canvas pixels per output pixel
uniform float uViewOriginY;   // output y at the canvas top
uniform bool  uSnap;          // pixel-inspection zoom: evaluate per output pixel, like the main pass
uniform float uScanAmount;    // 0–1: darkness at the centre of a scanline
uniform float uScanSpacing;   // scanline period in output pixels
uniform float uShift;         // RGB shift in output pixels
uniform vec2  uImageX;        // the image's left / right edge in canvas pixels

out vec4 outColor;

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

// Premultiplied sRGB texel → (linear colour, alpha)
vec4 fetch(vec2 fc) {
  vec4 t = texture(uImage, fc / uCanvas);
  return t.a > 0.0 ? vec4(toLinear(t.rgb / t.a), t.a) : vec4(0.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec4 c = fetch(fc);
  // Only pixels on the image are shifted; the canvas around it stays empty
  if (uShift > 0.0 && fc.x >= uImageX.x && fc.x <= uImageX.y) {
    float s = uShift * uViewScale;   // canvas pixels
    // Shifted reads stay on the image: past its edge they repeat the edge pixel (otherwise the
    // first s pixels lose their red, the last s their blue — an empty-looking strip)
    float lo = uImageX.x + 0.5, hi = uImageX.y - 0.5;
    vec4 r = fetch(vec2(clamp(fc.x - s, lo, hi), fc.y));
    vec4 b = fetch(vec2(clamp(fc.x + s, lo, hi), fc.y));
    // Each gun lands its own channel; alpha is wherever any of them painted
    float a = max(c.a, max(r.a, b.a));
    vec3 rgb = vec3(r.r * r.a, c.g * c.a, b.b * b.a) / max(a, 1e-6);
    c = vec4(rgb, a);
  }
  if (uScanAmount > 0.0) {
    float y = (uCanvas.y - fc.y) / uViewScale + uViewOriginY;   // output pixels, top-down
    if (uSnap) y = floor(y) + 0.5;
    float band = 0.5 + 0.5 * cos(6.2831853 * y / uScanSpacing);  // 1 at a line's centre
    float visible = smoothstep(1.5, 3.0, uScanSpacing * uViewScale);
    float dark = uScanAmount * mix(0.5, band, visible);
    c.rgb *= 1.0 - dark;
  }
  outColor = vec4(toSrgb(c.rgb) * c.a, c.a);
}`;
