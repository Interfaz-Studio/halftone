# Contributing

Thanks for helping. Bug reports, fixes and small, focused improvements are very welcome.

## Before you start

- **Bugs:** open an issue with the browser, OS, GPU if you know it, and, if you can, the image
  and settings that show the problem. A Studio share link (the link icon in the top bar) captures
  the settings.
- **Features:** open an issue first so we can agree on the approach before you write code.

## Working on the engine

```bash
npm install
npm run dev
npm run checks   # in a second terminal
```

The engine promises tone accuracy; changes to `packages/core` must keep `npm run checks` green.
If you add a shape, dither or parameter, add checks for it in `apps/web/src/checks.ts`, and unit
tests for any maths in `packages/core/test`.

- TypeScript, strict mode. No runtime dependencies in `packages/core`.
- Match the surrounding style. Comments explain why, not what.
- Keep the public API documented in `packages/core/README.md`; its code samples are type-checked
  from `packages/core/test/readme-examples.ts`.

## Pull requests

- One change per pull request, with a short description of what and why.
- `npm test`, `npm run typecheck` and `npm run checks` pass.
- Update `packages/core/CHANGELOG.md` for user-facing engine changes.

By contributing you agree that your contributions are licensed under the MIT License.
