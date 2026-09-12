# CLI package design (S12)

Status: S12.1 measurements and the S12.2 decision recorded on 2026-09-12
against `0cef22e` (core 0.10.0-rc.2, every driver extracted). S12.3/S12.4
evidence is appended in §5 as the split lands.

## 1. What remains in a core-only install (S12.1)

Fixture A of the inventory harness (packed `@tulipes/core` alone, isolated
Yarn cache, `reports/s09-inventory/0cef22e/`), graphs walked over
`dependencies` **and** `optionalDependencies` — esbuild's platform binary is
optional and was invisible before:

| Attribution | Packages | Bytes | Share of 26,951,757 |
|---|---:|---:|---:|
| `tsx` → esbuild + `@esbuild/<platform>` + get-tsconfig | 4 | 11,446,682 | 42.5% |
| `node-gyp` and its 19 dependencies — added by Yarn because esbuild has an install script; present only because of `tsx` | 20 | 7,274,168 | 27.0% |
| **TypeScript loader chain, total** | **24** | **18,720,850** | **69.5%** |
| `express` graph | 68 | 2,174,843 | 8.1% |
| `zod` | 1 | 3,594,196 | 13.3% |
| `i18next` + `i18next-fs-backend` | 2 | 1,207,739 | 4.5% |
| `dotenv`, `colorette` | 2 | 93,600 | 0.3% |
| **HTTP runtime, total** | **73** | **7,070,378** | **26.2%** |
| `@tulipes/core` itself | 1 | 1,160,529 | 4.3% |

The core archive (350,663 B compressed, 1,111,149 B unpacked) is itself mostly
tooling: `dist/cli` 586,163 B (53%), `templates/` 61,946 B (6%), `assets/`
91,991 B (8%), runtime `dist/` 272,661 B (25%), the rest docs and manifest.

Startup (harness, minimal fixture, `0cef22e`/`5bba0b3`): importing
`@tulipes/core/boot` 74 ms; the same import through `--import tsx` 101 ms; the
generated app's `tsx app.ts` readiness 232 ms. The loader costs ≈27 ms per
process start plus 18.7 MB per install.

Why `tsx` is in core's *runtime* dependencies at all: the global `tulipes`
binary must import an app's TypeScript files (`registerTypeScript()` in
`app-core.ts`) and `tulipes dev` runs tsx in watch mode. The application's own
`start`/`dev` scripts already use the app's own `tsx` dependency; `boot()`
never imports the loader. It is a tooling dependency carried by the runtime
package.

**Compiled-JavaScript comparison (S12.1, second half):** not possible today —
the generated app has no build step and its workspace modules export `.ts`
entrypoints (`"exports": { ".": "./index.ts" }`), so nothing but a TS loader
can run it. Recorded as an S14 candidate ("build the app" feature), not blocking.

Development-tool attribution for the minimal starter (fixture B, 106,158,341
B): `vite` 4.4 MB, `vitest` 4.3 MB, `typescript` 2.5 MB, `@tulipes/spec` 50 KB,
plus their type packages — application devDependencies by design, unaffected
by any core split.

## 2. Decision (S12.2)

**Split the CLI out of core** into `@tulipes/cli`, and remove `tsx` from core.
The measured case is unambiguous: 69.5% of a runtime install and 59% of the
archive exist for commands a running process never executes. Retaining the
CLI in core would leave the extraction program with a core that is mostly
loader.

Rejected alternative — keep the CLI, move `tsx` to `peerDependencies`/optional:
the global binary would break on apps that do not install `tsx` themselves,
`tulipes dev` would need a fallback, and the archive would still be 60% CLI.

### Command contract

| Aspect | Contract |
|---|---|
| Package | `@tulipes/cli` (0.1.0-rc.1), `bin: { tulipes }`, ships `dist/` and `templates/`; `dependencies`: `@tulipes/core` (the core it scaffolds for) and `tsx` |
| Installation | Global: `npm i -g @tulipes/cli@next` (or `yarn dlx @tulipes/cli init …`). Per app: generated apps add `@tulipes/cli` to `devDependencies`, so `yarn dev`, `yarn sync`, `yarn spec`, `yarn tulipes new module …` keep working with no script change |
| Executable lookup | `.bin/tulipes` from the app's devDependency first (Yarn scripts), the global install otherwise — as today |
| Core/spec compatibility | Unchanged mechanism: the CLI boots and inspects through **the app's** `@tulipes/core` (`importFromApp`), falling back to its bundled core; `tulipes -v` prints both versions. Generated dependency ranges come from the CLI's own bundled core version (`coreRange()`), spec/provider ranges as constants in the generator |
| Templates | `@tulipes/cli/templates/` (CLAUDE.md, skills, browser-auth.md); the CI parity diff moves with them |
| `tulipes update` | Updates the global `@tulipes/cli` and, in an app, `@tulipes/core` and `@tulipes/cli` ranges; provider ranges are listed for manual follow-up (recorded as a backlog item) |
| Core | Drops `bin`, `tsx`, `templates/`, `src/cli/`; exports `readProviderDeclarations` from `@tulipes/core/boot` (the one internal the CLI used). No stub binary: two packages cannot own one `.bin/tulipes` name; MIGRATING says `yarn add -D @tulipes/cli@next` |
| Archives | Six; `artifacts.mjs verify` checks the CLI archive's `bin` and templates instead of core's, and refuses a core that depends on `tsx` |
| Smokes | The launcher installs `@tulipes/cli` (which brings its bundled core); apps resolve `tulipes` from their own devDependency; the absence probe adds `tsx` and `esbuild` for the runtime anchors (core's directory) — the app anchor legitimately resolves them through its devDependency |

Migration for existing apps: `yarn add -D @tulipes/cli@next`; nothing else.
Expected runtime effect: a core-only install of ≈8.2 MB (−69%) and a
runtime archive of ≈0.3 MB unpacked; the generated app's *development*
install is unchanged in size (tsx moves from core to the CLI it already needs).

## 3. Delivery

| Change set | Work |
|---|---|
| S12-design (this) | Measurements and decision |
| S12.3 | `packages/cli` with the moved commands, templates and tests; core trimmed; generator adds the devDependency; example follows; artifacts/smokes/CI paths; docs |
| S12.4 | Fresh packed journeys for both presets (install → init → sync → check → types → tests → start → specs), module generation, upgrade — the existing smokes, now exercising the split |
| S12 measure | Fixture A after the split |

## 4. Fixtures

- Packed minimal launcher = `@tulipes/cli` only; `tulipes init`, `sync`,
  `env:check`, `routes --offline`, `spec --offline`, `new module` from the
  app's devDependency.
- Fixture A absence: `tsx`, `esbuild`, `node-gyp` unresolvable from core's
  directory; core archive without `dist/cli` or `templates/`.
- Upgrade smoke: the rc.3 starter's migration adds `@tulipes/cli` and keeps
  every script working.

## 5. Evidence

Appended as S12.3/S12.4 land.
