import { buildRadiusLut } from './coverage.js';
import { SHAPES, SHAPE_ID, buildThresholdLut, type Shape } from './shapes.js';
import { DITHER_METHODS, bayer, blueNoise, isOrdered, type DiffusionJob, type DitherMethod } from './dither.js';
import { lightness, luminance, parseColor, srgbToLinear } from './color.js';
import { FRAGMENT, POST, VERTEX } from './shaders.js';

/** How the source is placed in the output, like CSS `object-fit`. */
export type Fit = 'cover' | 'contain' | 'fill';

export interface HalftoneParams {
  /** `dots`: an AM halftone screen. `dither`: square pixels, each fully inked or not. */
  mode: 'dots' | 'dither';
  /** Dither method. Error-diffusion methods (`floyd`, `atkinson`) need `updateDiffusion()`. */
  dither: DitherMethod;
  /** Dither pixel size in reference pixels (× `pixelRatio`), ≥ 1. */
  pixel: number;
  /** Distance between dot centres, in reference pixels (multiplied by `pixelRatio`). */
  cell: number;
  /** Screen angle in degrees, counter-clockwise from horizontal (print convention). */
  angle: number;
  /** Dot shape. `euclidean` is the classic choice for photographs. */
  shape: Shape;
  /** Ellipse only: dot height ÷ width, 0.2–1. */
  ratio: number;
  /** Lightness offset, −1…1. */
  brightness: number;
  /** −1…1; 0 is neutral. */
  contrast: number;
  /** > 0; above 1 lifts the midtones, below 1 deepens them. */
  gamma: number;
  /** Swap light and dark before screening. */
  invert: boolean;
  /** Dot colour (any CSS hex / rgb() / `transparent`). */
  ink: string;
  /** Background colour. Also sets the tone: ink goes where the image is closer to the ink than
   *  to the paper — so it matters even when `transparent` is on. */
  paper: string;
  /** Leave the paper out of the output (a cut-out PNG). The tone is still computed against `paper`. */
  transparent: boolean;
  fit: Fit;
  /** CRT scanlines: darkness at a line's centre, 0 (off) – 1. */
  scanlines: number;
  /** Scanline period in reference pixels (× `pixelRatio`), ≥ 2. */
  scanlineSpacing: number;
  /** CRT RGB shift: red and blue offset sideways by this many reference pixels, 0 = off. */
  rgbShift: number;
  /** Dot edge width in output pixels, ≥ 1. 1 is crisp (antialiased); larger values blur the edges. */
  softness: number;
  /** Output pixels per reference pixel: `devicePixelRatio` for live canvases, the scale for exports. */
  pixelRatio: number;
  /** Antialiasing subsamples per axis, 1–8. 6 keeps tone within 1 L* for every shape, down to
   *  sub-pixel lines; 4 is a good interactive preview (~2× faster). */
  quality: number;
}

export const DEFAULTS: Readonly<HalftoneParams> = Object.freeze({
  mode: 'dots',
  dither: 'blue',
  pixel: 2,
  cell: 8,
  angle: 45,
  shape: 'euclidean',
  ratio: 0.6,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  invert: false,
  ink: '#000000',
  paper: '#FFFFFF',
  transparent: false,
  fit: 'cover',
  softness: 1,
  scanlines: 0,
  scanlineSpacing: 3,
  rgbShift: 0,
  pixelRatio: 1,
  quality: 6,
});

/** Smallest cell the screen supports, in output pixels — below this dots can't be drawn. */
export const MIN_CELL_PX = 2;

const LUT_SIZE = 1024;

export interface HalftoneOptions {
  /** Keep the drawing buffer after compositing (needed to read pixels back later). */
  preserveDrawingBuffer?: boolean;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

/** Which part of the output the canvas shows: `scale` canvas pixels per output pixel, `x`/`y` the
 *  output pixel at the canvas' top-left corner. `snap` draws each output pixel as a flat block
 *  (only meaningful at whole-number scales — the default turns it on exactly there). */
export interface View { scale: number; x: number; y: number; snap?: boolean }

/**
 * A halftone screen rendered with WebGL2 into a canvas.
 *
 * ```ts
 * const ht = new Halftone(canvas, { cell: 10, angle: 15 });
 * ht.setSource(image);
 * ht.render();
 * ```
 * By default the canvas shows the whole output 1:1 (output size = canvas size). For an
 * interactive viewer, set a separate output size and a view (zoom / pan) — only the visible part
 * is rendered, at screen resolution, so any image size stays fast.
 * Rendering is explicit — `render()` after changing params, the view or the canvas size.
 */
export class Halftone {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms = {};
  private sourceTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  private threshTex: WebGLTexture | null = null;
  private maskTex: WebGLTexture | null = null;
  private threshKey = '';
  private mask: { data: Uint8Array; w: number; h: number } | null = null;
  private sourcePixels: Uint8ClampedArray | null = null;   // lazily read for error diffusion
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  // Post pass (CRT effects): the main pass renders into fboTex, then POST draws it to the canvas
  private postProgram: WebGLProgram | null = null;
  private postUniforms: Uniforms = {};
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private fboSize: [number, number] = [0, 0];
  private source: TexImageSource | null = null;
  private sourceSize: [number, number] = [0, 0];
  private current: HalftoneParams;
  private outputSize: [number, number] | null = null;
  private view: View = { scale: 1, x: 0, y: 0 };
  private lutKey = '';   // shape + ratio the LUT texture currently holds
  private lost = false;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, params: Partial<HalftoneParams> = {}, options: HalftoneOptions = {}) {
    this.canvas = canvas;
    this.current = validate({ ...DEFAULTS, ...params });
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,   // the shader antialiases dot edges itself
      depth: false,
      stencil: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', this.onLost as EventListener);
    canvas.addEventListener('webglcontextrestored', this.onRestored as EventListener);
    this.init();
  }

  /** True when WebGL2 can be used in this environment. */
  static isSupported(): boolean {
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
      // Release the probe context at once: browsers cap live contexts per page
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!gl;
    } catch {
      return false;
    }
  }

  get params(): Readonly<HalftoneParams> {
    return this.current;
  }

  /** Largest source or output side this GPU accepts, in pixels. */
  get maxSize(): number {
    const gl = this.gl;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, dims[0] ?? 0, dims[1] ?? 0);
  }

  /** Merge new params. Throws on invalid values and leaves the previous params untouched. */
  set(params: Partial<HalftoneParams>): void {
    this.current = validate({ ...this.current, ...params });
  }

  /**
   * Logical output size in pixels, independent of the canvas — e.g. the source size for a viewer.
   * `null` (default) uses the canvas size.
   */
  setOutputSize(size: { width: number; height: number } | null): void {
    if (size && !(size.width > 0 && size.height > 0)) throw new RangeError('Output size must be positive');
    this.outputSize = size ? [size.width, size.height] : null;
  }

  /** Zoom / pan: `scale` canvas pixels per output pixel; `x`, `y` = output pixel at the canvas' top-left. */
  setView(view: Partial<View>): void {
    const v = { ...this.view, ...view };
    if (!(v.scale > 0) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) throw new RangeError('Invalid view');
    this.view = v;
  }

  /** Set the canvas' pixel size. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /**
   * Upload a new source (image, canvas, video frame, ImageBitmap…). For video, call again per frame.
   * Pass `null` to clear. The source must be fully loaded / decoded. ImageBitmaps with transparency
   * should be created with `{ premultiplyAlpha: 'premultiply' }`.
   */
  setSource(source: TexImageSource | null): void {
    this.source = source;
    if (!source) { this.sourceSize = [0, 0]; return; }
    const [w, h] = sizeOf(source);
    if (!w || !h) throw new Error('Source has no pixels yet (is it loaded?)');
    if (Math.max(w, h) > this.maxSize) throw new Error(`Source is ${w}×${h}px; this GPU allows up to ${this.maxSize}px per side`);
    this.sourceSize = [w, h];
    this.sourcePixels = null;
    this.mask = null;
    if (!this.lost) this.upload();
  }

  /**
   * The error-diffusion job for the current source and params, or null when the current params
   * don't use error diffusion. Run it with `diffusionKernel` (or a `DiffusionWorker`) and hand the
   * result to `setDiffusionMask` — see `updateDiffusion` for the whole round trip.
   */
  diffusionJob(): DiffusionJob | null {
    const p = this.current;
    if (p.mode !== 'dither' || isOrdered(p.dither) || !this.source) return null;
    const [W, H] = this.outputSize ?? [this.canvas.width, this.canvas.height];
    const px = p.pixel * p.pixelRatio;
    const { scale, offset } = fitUv(p.fit, this.sourceSize, [W, H]);
    const t = this.toneUniforms();
    return {
      pixels: this.readSourcePixels(),
      sw: this.sourceSize[0], sh: this.sourceSize[1],
      gw: Math.ceil(W / px), gh: Math.ceil(H / px),
      uvScale: [scale[0] * (Math.ceil(W / px) * px) / W, scale[1] * (Math.ceil(H / px) * px) / H],
      uvOffset: offset,
      clampEdges: p.fit !== 'contain',
      tone: { brightness: p.brightness, contrast: p.contrast, gamma: p.gamma, invert: p.invert, ...t },
      method: p.dither as 'floyd' | 'atkinson',
    };
  }

  /** Use an error-diffusion result (1 byte per dither pixel, 1 = ink). */
  setDiffusionMask(data: Uint8Array, width: number, height: number): void {
    if (data.length !== width * height) throw new RangeError('Mask size does not match width × height');
    this.mask = { data, w: width, h: height };
    if (!this.lost) this.uploadMask();
  }

  /**
   * Compute and apply the error diffusion for the current params. Resolves true when the result
   * was applied, false when the params no longer need it or a newer request superseded it.
   */
  async updateDiffusion(run: (job: DiffusionJob) => Promise<Uint8Array | null> | Uint8Array): Promise<boolean> {
    const job = this.diffusionJob();
    if (!job) return false;
    const mask = await run(job);
    if (!mask || this.destroyed) return false;
    this.setDiffusionMask(mask, job.gw, job.gh);
    return true;
  }

  render(): void {
    if (this.lost || this.destroyed || !this.program) return;
    const gl = this.gl, u = this.uniforms, p = this.current;
    const CW = this.canvas.width, CH = this.canvas.height;
    if (Math.max(CW, CH) > this.maxSize) throw new Error(`Canvas is ${CW}×${CH}px; this GPU allows up to ${this.maxSize}px per side`);
    const [W, H] = this.outputSize ?? [CW, CH];

    const effects = p.scanlines > 0 || p.rgbShift > 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, CW, CH);
    if (!this.source) {
      // Nothing to screen: show plain paper (the drawing buffer holds sRGB-encoded, premultiplied values)
      const [r, g, b, pa] = parseColor(p.paper);
      const a = p.transparent ? 0 : pa;
      gl.clearColor(r * a, g * a, b * a, a);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    const paper = toLinear(p.paper);
    const ink = toLinear(p.ink);
    const { inkY, paperY, lightMin, lightMax } = this.toneUniforms();
    const cell = p.cell * p.pixelRatio;
    const { scale, offset } = fitUv(p.fit, this.sourceSize, [W, H]);
    // Source texels covered by one cell → the mip level that averages exactly one cell
    const texelsPerCell = cell * Math.max((scale[0] * this.sourceSize[0]) / W, (scale[1] * this.sourceSize[1]) / H);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uSource!, 0);
    gl.uniform1i(u.uLut!, 1);
    gl.uniform2f(u.uCanvas!, CW, CH);
    gl.uniform2f(u.uOutput!, W, H);
    gl.uniform1f(u.uViewScale!, this.view.scale);
    gl.uniform2f(u.uViewOrigin!, this.view.x, this.view.y);
    gl.uniform1i(u.uViewSnap!, (this.view.snap ?? (this.view.scale >= 1 && Number.isInteger(this.view.scale))) ? 1 : 0);
    gl.uniform1f(u.uTexelsPerPx!, texelsPerCell / cell);
    gl.uniform2f(u.uUvScale!, scale[0], scale[1]);
    gl.uniform2f(u.uUvOffset!, offset[0], offset[1]);
    gl.uniform1i(u.uClampEdges!, p.fit === 'contain' ? 0 : 1);
    gl.uniform2f(u.uOrigin!, W / 2, H / 2);
    gl.uniform1f(u.uCell!, cell);
    gl.uniform1f(u.uAngle!, (-p.angle * Math.PI) / 180);   // y points down on screen: negate for CCW
    gl.uniform1f(u.uLod!, Math.max(0, Math.log2(texelsPerCell)));
    gl.uniform1f(u.uLutSize!, LUT_SIZE);
    gl.uniform1f(u.uSoftness!, p.softness);
    gl.uniform1i(u.uSamples!, p.quality);
    gl.uniform1i(u.uShape!, SHAPE_ID[p.shape]);
    gl.uniform1f(u.uRatio!, p.ratio);
    this.uploadLut();
    gl.uniform1f(u.uBrightness!, p.brightness);
    gl.uniform1f(u.uContrast!, p.contrast);
    gl.uniform1f(u.uGamma!, p.gamma);
    gl.uniform1i(u.uInvert!, p.invert ? 1 : 0);
    gl.uniform4f(u.uInk!, ink[0], ink[1], ink[2], ink[3]);
    // Transparency only affects what is drawn; paperY above keeps the tone tied to the paper colour
    gl.uniform4f(u.uPaper!, paper[0], paper[1], paper[2], p.transparent ? 0 : paper[3]);
    gl.uniform1f(u.uInkY!, inkY);
    gl.uniform1f(u.uPaperY!, paperY);
    gl.uniform1f(u.uLightMin!, lightMin);
    gl.uniform1f(u.uLightMax!, lightMax);

    // Dither: ordered methods tile a threshold map; error diffusion reads its mask, falling back to
    // blue noise until a mask of the right size is available (so a preview is never blank).
    let mode = 0;
    if (p.mode === 'dither') {
      const px = p.pixel * p.pixelRatio;
      const maskOk = !isOrdered(p.dither) && this.mask && this.mask.w === Math.ceil(W / px) && this.mask.h === Math.ceil(H / px);
      mode = maskOk ? 2 : 1;
      this.uploadThresholds(maskOk || isOrdered(p.dither) ? p.dither : 'blue');
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.threshTex);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.uniform1i(u.uThresh!, 2);
      gl.uniform1i(u.uMask!, 3);
      gl.uniform1i(u.uThreshN!, thresholdSize(isOrdered(p.dither) ? p.dither : 'blue'));
      gl.uniform1f(u.uPixel!, px);
      gl.uniform1f(u.uLodPixel!, Math.max(0, Math.log2(Math.max(1, px * texelsPerCell / cell))));
      if (this.mask) gl.uniform2i(u.uMaskSize!, this.mask.w, this.mask.h);
    }
    gl.uniform1i(u.uMode!, mode);
    if (effects) this.bindFbo(CW, CH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (effects) this.drawPost(CW, CH);
  }

  private toneUniforms() {
    const p = this.current;
    const paper = toLinear(p.paper), ink = toLinear(p.ink);
    const inkY = luminance(ink[0], ink[1], ink[2]);
    const paperY = luminance(paper[0], paper[1], paper[2]);
    return { inkY, paperY, lightMin: lightness(Math.min(inkY, paperY)), lightMax: lightness(Math.max(inkY, paperY)) };
  }

  /** Free GPU resources and listeners. The instance can't be used afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost as EventListener);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored as EventListener);
    if (!this.lost) {
      const gl = this.gl;
      gl.deleteTexture(this.sourceTex);
      gl.deleteTexture(this.lutTex);
      gl.deleteTexture(this.threshTex);
      gl.deleteTexture(this.maskTex);
      gl.deleteProgram(this.program);
      gl.deleteVertexArray(this.vao);
      gl.deleteBuffer(this.vbo);
      gl.deleteProgram(this.postProgram);
      gl.deleteFramebuffer(this.fbo);
      gl.deleteTexture(this.fboTex);
      // Hand the context back now rather than at garbage collection: browsers cap live contexts
      // per page (Safari ~16) and drop the oldest — which would be the app's preview.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.source = null;
    this.sourcePixels = null;
    this.mask = null;
  }

  // ── internals ──────────────────────────────────────────────

  private init(): void {
    const gl = this.gl;
    this.program = link(gl, VERTEX, FRAGMENT);
    this.uniforms = {};
    const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(this.program, i);
      if (info) this.uniforms[info.name] = gl.getUniformLocation(this.program, info.name);
    }
    // Full-screen triangle at attribute 0, shared by the main and post programs
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.postProgram = link(gl, VERTEX, POST);
    this.postUniforms = {};
    const postCount = gl.getProgramParameter(this.postProgram, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < postCount; i++) {
      const info = gl.getActiveUniform(this.postProgram, i);
      if (info) this.postUniforms[info.name] = gl.getUniformLocation(this.postProgram, info.name);
    }
    this.fbo = null; this.fboTex = null; this.fboSize = [0, 0];

    // Coverage lookup table (filled per shape in uploadLut). R32F isn't filterable everywhere,
    // so the shader interpolates itself.
    this.lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.lutKey = '';

    // Dither threshold map (tiled, R32F) and error-diffusion mask (R8), both sampled with texelFetch
    this.threshTex = gl.createTexture();
    this.maskTex = gl.createTexture();
    for (const t of [this.threshTex, this.maskTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    // A 1×1 mask so the sampler is always complete
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    this.threshKey = '';
    if (this.mask) this.uploadMask();

    this.sourceTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.source) this.upload();
  }

  /** Render target for the main pass when effects are on; (re)allocated to the canvas size. */
  private bindFbo(w: number, h: number): void {
    const gl = this.gl;
    // Unit 4 is reserved for this texture: binding it on whatever unit happens to be active would
    // replace one of the main pass's inputs (LUT, mask…) and blank the frame
    gl.activeTexture(gl.TEXTURE4);
    if (!this.fbo) {
      this.fbo = gl.createFramebuffer();
      this.fboTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (this.fboSize[0] !== w || this.fboSize[1] !== h) {
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
      this.fboSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
  }

  private drawPost(w: number, h: number): void {
    const gl = this.gl, u = this.postUniforms, p = this.current;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.postProgram);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(u.uImage!, 4);
    gl.uniform2f(u.uCanvas!, w, h);
    gl.uniform1f(u.uViewScale!, this.view.scale);
    gl.uniform1f(u.uViewOriginY!, this.view.y);
    gl.uniform1i(u.uSnap!, (this.view.snap ?? (this.view.scale >= 1 && Number.isInteger(this.view.scale))) ? 1 : 0);
    gl.uniform1f(u.uScanAmount!, p.scanlines);
    gl.uniform1f(u.uScanSpacing!, p.scanlineSpacing * p.pixelRatio);
    gl.uniform1f(u.uShift!, p.rgbShift * p.pixelRatio);
    const W = (this.outputSize ?? [w, h])[0];
    gl.uniform2f(u.uImageX!, Math.max(0, -this.view.x * this.view.scale), Math.min(w, (W - this.view.x) * this.view.scale));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private uploadThresholds(method: DitherMethod): void {
    if (method === this.threshKey) return;
    const gl = this.gl, n = thresholdSize(method);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.threshTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, n, 0, gl.RED, gl.FLOAT, thresholdMap(method));
    this.threshKey = method;
  }

  private uploadMask(): void {
    const gl = this.gl, m = this.mask!;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.w, m.h, 0, gl.RED, gl.UNSIGNED_BYTE, m.data.map(v => (v ? 255 : 0)));
  }

  private readSourcePixels(): Uint8ClampedArray {
    if (this.sourcePixels) return this.sourcePixels;
    const [w, h] = this.sourceSize;
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.source as CanvasImageSource, 0, 0);
    this.sourcePixels = ctx.getImageData(0, 0, w, h).data;
    return this.sourcePixels;
  }

  /** Fill the LUT for the current shape: dot radii for round, spot thresholds for the rest. */
  private uploadLut(): void {
    const { shape, ratio } = this.current;
    const key = shape === 'ellipse' ? `${shape}:${ratio}` : shape;
    if (key === this.lutKey) return;
    const gl = this.gl;
    const data = shape === 'round' ? buildRadiusLut(LUT_SIZE) : cachedThresholds(shape, ratio);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, LUT_SIZE, 1, 0, gl.RED, gl.FLOAT, data);
    this.lutKey = key;
  }

  private upload(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    // sRGB storage: sampling and mip generation happen in linear light, so cell averages are correct.
    // Premultiplied so transparent pixels don't bleed black into the averages. For DOM sources the
    // browser premultiplies on upload; ImageBitmaps carry their own alpha mode (the unpack flags are
    // ignored for them, and deprecated in Firefox), so create them with premultiplyAlpha: 'premultiply'.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, isDomSource(this.source!));
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, this.source!);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);   // back to the default for data uploads
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private onLost = (e: Event): void => {
    e.preventDefault();   // tells the browser we want the context back
    this.lost = true;
  };

  private onRestored = (): void => {
    if (this.destroyed) return;
    this.lost = false;
    this.init();
    this.render();
  };
}

// Dither threshold maps, built once per method and shared.
const thresholdMaps = new Map<DitherMethod, Float32Array>();
function thresholdSize(m: DitherMethod): number {
  return m === 'bayer2' ? 2 : m === 'bayer4' ? 4 : m === 'bayer8' ? 8 : 64;
}
function thresholdMap(m: DitherMethod): Float32Array {
  const key = isOrdered(m) ? m : 'blue';
  let map = thresholdMaps.get(key);
  if (!map) {
    map = key === 'blue' ? blueNoise(64) : bayer(thresholdSize(key));
    thresholdMaps.set(key, map);
  }
  return map;
}

// Threshold tables are pure functions of (shape, ratio); share them between instances.
const thresholdCache = new Map<string, Float32Array>();
function cachedThresholds(shape: Shape, ratio: number): Float32Array {
  const key = `${shape}:${shape === 'ellipse' ? ratio : 1}`;
  let lut = thresholdCache.get(key);
  if (!lut) {
    lut = buildThresholdLut(shape, ratio, LUT_SIZE);
    if (thresholdCache.size > 32) thresholdCache.clear();   // ellipse ratios can be many
    thresholdCache.set(key, lut);
  }
  return lut;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  const program = gl.createProgram()!;
  const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/** Sources the browser can premultiply on upload (elements, as opposed to ImageBitmap & co.). */
function isDomSource(src: TexImageSource): boolean {
  return (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement)
    || (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement)
    || (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement);
}

function toLinear(css: string): [number, number, number, number] {
  const [r, g, b, a] = parseColor(css);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a];
}

function sizeOf(src: TexImageSource): [number, number] {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return [src.displayWidth, src.displayHeight];
  const s = src as { width: number; height: number };
  return [s.width, s.height];
}

/** uv = p / output * scale + offset, implementing object-fit for the source. */
export function fitUv(fit: Fit, src: readonly [number, number], out: readonly [number, number]): { scale: [number, number]; offset: [number, number] } {
  if (fit === 'fill' || !src[0] || !src[1]) return { scale: [1, 1], offset: [0, 0] };
  // r > 1: the source is wider than the output. A scale below 1 crops that axis, above 1 letterboxes it.
  // cover crops the source's overflowing side; contain letterboxes the other one.
  const r = (src[0] / src[1]) / (out[0] / out[1]);
  const s: [number, number] = (fit === 'cover') === (r > 1) ? [1 / r, 1] : [1, r];
  return { scale: s, offset: [(1 - s[0]) / 2, (1 - s[1]) / 2] };
}

function validate(p: HalftoneParams): HalftoneParams {
  const fail = (msg: string) => { throw new RangeError(`Invalid halftone param: ${msg}`); };
  const finite = (k: keyof HalftoneParams) => { if (!Number.isFinite(p[k] as number)) fail(`${k} must be a finite number`); };
  (['cell', 'angle', 'brightness', 'contrast', 'gamma', 'softness', 'pixelRatio'] as const).forEach(finite);
  if (p.cell * p.pixelRatio < MIN_CELL_PX) fail(`cell × pixelRatio must be at least ${MIN_CELL_PX}px`);
  if (p.gamma <= 0) fail('gamma must be > 0');
  if (p.softness < 1) fail('softness must be ≥ 1');
  if (p.pixelRatio <= 0) fail('pixelRatio must be > 0');
  if (!Number.isInteger(p.quality) || p.quality < 1 || p.quality > 8) fail('quality must be an integer 1–8');
  if (p.brightness < -1 || p.brightness > 1) fail('brightness must be within −1…1');
  if (p.contrast < -1 || p.contrast > 1) fail('contrast must be within −1…1');
  if (!['cover', 'contain', 'fill'].includes(p.fit)) fail(`fit must be cover, contain or fill`);
  if (typeof p.transparent !== 'boolean') fail('transparent must be a boolean');
  if (!SHAPES.includes(p.shape)) fail(`shape must be one of ${SHAPES.join(', ')}`);
  if (p.mode !== 'dots' && p.mode !== 'dither') fail('mode must be dots or dither');
  if (!(p.scanlines >= 0 && p.scanlines <= 1)) fail('scanlines must be within 0…1');
  if (!(p.scanlineSpacing * p.pixelRatio >= 2) || !Number.isFinite(p.scanlineSpacing)) fail('scanlineSpacing × pixelRatio must be at least 2px');
  if (!(p.rgbShift >= 0 && p.rgbShift <= 50)) fail('rgbShift must be within 0…50');
  if (!DITHER_METHODS.includes(p.dither)) fail(`dither must be one of ${DITHER_METHODS.join(', ')}`);
  if (!(p.pixel * p.pixelRatio >= 1) || !Number.isFinite(p.pixel)) fail('pixel × pixelRatio must be at least 1px');
  if (!(p.ratio >= 0.2 && p.ratio <= 1)) fail('ratio must be within 0.2…1');
  parseColor(p.ink);
  parseColor(p.paper);
  return Object.freeze({ ...p }) as HalftoneParams;
}
