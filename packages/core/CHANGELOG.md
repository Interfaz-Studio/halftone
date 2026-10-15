# Changelog

## 0.1.0

First release.

- WebGL2 halftone engine: `Halftone` (live, any canvas) and `exportImage` (full resolution).
- Seven AM dot shapes: round, euclidean, square, diamond, ellipse, line, cross.
- Six dithers: Bayer 2×2 / 4×4 / 8×8, blue noise, Floyd–Steinberg, Atkinson (`DiffusionWorker`).
- Perceptual tone mapping between any two inks, transparent paper, brightness / contrast / gamma / invert.
- CRT pass: scanlines and RGB shift.
- Zoom and pan views that render only the visible part.
- Automatic recovery from WebGL context loss.
- `isSupported()` releases its probe context straight away.
