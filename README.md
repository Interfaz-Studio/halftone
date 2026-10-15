# Halftone

Real halftone screens for the web: a WebGL2 engine and a free studio tool, by
[interfaz.studio](https://interfaz.studio).

- **[Halftone Studio](https://halftone.interfaz.studio/studio/)**: drop an image, tune the screen,
  export a PNG. Runs entirely in your browser; images are never uploaded.
- **[`@interfaz/halftone`](packages/core)**: the engine, MIT-licensed and dependency-free. Seven dot
  shapes, six dithers and a CRT pass, tone-accurate to under 1 L*.

```ts
import { Halftone } from '@interfaz/halftone';

const ht = new Halftone(canvas, { shape: 'euclidean', cell: 8 });
ht.setSource(image);
ht.render();
```

Full documentation: [packages/core/README.md](packages/core/README.md).

## Repository

```
packages/core    @interfaz/halftone — the engine (published to npm)
apps/web         halftone.interfaz.studio (Astro): presentation page, /studio, engine bench pages
brand            logo sources
scripts          tooling (GPU check runner)
```

## Develop

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173 — / (presentation), /studio/, /lab/, /checks/
npm test             # unit tests: engine maths, share links
npm run checks       # engine checks on a real GPU, in headless Chrome (needs `npm run dev`)
npm run typecheck
npm run build
```

`npm run checks` renders on the GPU and measures the output: tone accuracy for every shape and
dither, exports, transparency, views, context loss. Run it before any change to the engine.

## Third-party assets

The MIT license covers the code in this repository. It does not cover:

- **Milker** (`apps/web/public/fonts/Milker.woff2`), the display face of the presentation page: a
  commercial font, not included in the repository. Without it the page falls back to Geist.
- **Sample images** (`apps/web/public/samples/`): not included in the repository.

Geist, Geist Pixel, DM Sans and JetBrains Mono are used under the SIL Open Font License.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © interfaz.studio
