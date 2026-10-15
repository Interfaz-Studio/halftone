import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

// `/` is the presentation page, `/studio/` the tool, `/lab/` and `/checks/` engine bench pages.
// The engine is used from source (packages/core), so no rebuild is needed while developing.
export default defineConfig({
  site: 'https://halftone.interfaz.studio',
  output: 'static',
  trailingSlash: 'ignore',
  server: { port: 5173 },
  devToolbar: { enabled: false },
  vite: {
    // Never inline scripts or assets into the HTML: the CSP (public/_headers) allows scripts from
    // our own origin only, so every script must be a file
    build: { assetsInlineLimit: 0 },
    resolve: { alias: { '@interfaz/halftone': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  },
});
