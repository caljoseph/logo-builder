# Logo Builder

An extremely simple PWA for composing a logo from a flat sphere and realistic baseball-cover layers.

The source of truth for product behavior, UI constraints, rendering math, persistence, export, and verification is [APP_SPEC.md](APP_SPEC.md).

Implementation should not intentionally diverge from the spec. When the intended app changes, update the spec in the same change.

## Development

```sh
npm install
npm run dev
npm run build
npm run verify:ui
```

GitHub Pages deployment is handled by `.github/workflows/publish-pages.yml` from `main`.
