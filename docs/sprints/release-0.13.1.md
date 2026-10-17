# Release — core 0.13.1, the new brand

Status: **prepared on 2026-10-17** on `release/0.13.1`; not yet tagged.
A patch on the 0.13 line with no API change, so no candidate. It carries
`bd45f0a` (README and scaffold-comment fixes) and the rebrand.

## Scope

- **The new logo.** A geometric tulip in `#253E34` on `#F4EFE6` with a
  serif `tulipesjs` wordmark replaces the photographic tulip. The
  designer's originals stay in `assets/brand-kit/`. Variants derived from
  their paths ship in core under `assets/brand/`:
  - `mark`, `mark-tile` and `mark-inverse-tile`;
  - `lockup-horizontal` and `lockup-horizontal-dark`, where the tulip runs
    from the ascender to the baseline;
  - `lockup-stacked`, the supplied layout cropped tight;
  - `social-card`, 1280×640;
  - `lockup-bloom`, the README header: the stem grows, the bud opens and
    the wordmark wipes in once, about 1.4 s, in CSS only, so it plays
    inside an `<img>`. Reduced motion shows the last frame.

  `assets/social-card.png` and `assets/mark-tile-512.png` are made from
  those SVGs by headless Chrome. They stay in the repository: GitHub's
  social preview and favicons want PNG, and the package doesn't need it.
- **READMEs.** All eight package READMEs load `lockup-bloom.svg` from
  jsDelivr at `@tulipes/core@0.13.1`. The root README uses `<picture>`,
  with the cream lockup under a dark colour scheme. `tulipesjs-logo.png` is
  deleted; READMEs published earlier pin `@0.7.1` and keep their image.
- **Packages:** core `0.13.1`, `@tulipes/cli` `0.4.1`, `@tulipes/mcp` `0.2.1`,
  `@tulipes/spec` `0.4.2`, `@tulipes/mongoose` and `@tulipes/bullmq` `0.2.3`,
  `@tulipes/testing` `0.1.3`, `@tulipes/socket.io` `0.1.5`. That makes
  eight archives, published to dist-tag `latest`. The peer ranges are
  unchanged and already admit 0.13.1.

## Known limits, stated

- The bloom has been checked in Chrome only, frame by frame at 0–1400 ms
  through the Web Animations API. Safari and Firefox weren't tried; if one
  of them ignores the animation, the static final frame shows.
- The social card's tagline is SVG `<text>` in Georgia. The PNG is the
  artefact to use, because an SVG viewer without Georgia falls back to
  another serif.
- `ingress-smoke.mjs` and `failure-smoke.mjs` need Docker and weren't run.
  Nothing they exercise changed.

## Evidence

Local: this Mac, 2026-10-17, Node 24, pnpm 10.28.0, MongoDB and Redis on
127.0.0.1, no Docker.

| Check | Local | CI |
|---|---|---|
| frozen install, `typecheck`, `test:types` | pass; the bumps leave the lockfile unchanged | |
| `test:coverage` (MongoDB, Redis, `REQUIRE_INTEGRATION_TESTS=1`) | 40 files, 413 passed; 94.84 / 91.37 / 94.08 / 95.92, the same as 0.13.0 | |
| `artifacts.mjs prepare` + `verify` | eight archives verify; core has `assets/brand/*.svg` and no PNG; the CLI's `versions.json` pins the new versions | |
| scaffold smoke, minimal, local archives | pass: packed install, generated types, tests, specs, backend/shutdown, mcp (13.6 s) | |

A stale root `node_modules` from before pnpm (real directories dated
2026-08-29) first failed `settings.test.ts`. The fixture linked a second
copy of zod, which lost `.describe()` metadata. A fresh
`pnpm install --frozen-lockfile` fixed it. It was a local artefact only:
CI installs fresh.

## Publication

Pending.
