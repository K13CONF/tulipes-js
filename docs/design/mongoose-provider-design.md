# Mongoose provider design (S09.2)

Status: S09.2 complete and the extraction (S09.4 runtime move, S09.5 core
dependency removal, S09.6 consumer migration, S09.8 artifact tooling) landed on
2026-09-11 as one coherent change — §9.2 records the evidence. The provider is
`packages/mongoose` (`@tulipes/mongoose` 0.1.0-rc.1, unpublished); the package
name and ranges remain release-maintainer decisions until publication.

Plan: [Sprint 03 §5](../sprints/production-readiness-03.md#5-s092--select-the-provider-interface).
Inputs: [dependency inventory](mongoose-dependency-inventory.md) (register rows
`R1`–`R41`, open questions `Q1`–`Q8`).

## 1. Decision summary

| Question | Decision |
|---|---|
| Candidate | **A — one models acquisition seam.** Core keeps a single optional `ctx.models` slot whose type is an empty, augmentable interface; the provider package supplies the Mongoose implementation and augments the type. B (keyed capability registry) rejected — §3. |
| Registration point (Q1) | One static declaration in the app's `package.json`: `"tulipes": { "providers": { "models": "@tulipes/mongoose" } }`. Read by boot, worker, script, runtime CLI, offline inspection and `sync` from the same file. No boot option. |
| Import timing | Declaration discovered in phase 4 with the module graph; the provider module is imported in phase 8 only, only by processes that boot. Offline inspection and `sync` read the declaration and never import it. |
| Module requirement (Q2) | Manifest key `"tulipes": { "requires": ["models"] }` in strict zod. A `models/` directory implies `requires: ["models"]`; a consumer without model files declares it explicitly. Checked in phase 4 against the declared provider keys — before any module code is imported. |
| Access contract (Q3) | `ctx.models?: ModelsCapability`, `DatabaseCtx.models: ModelsCapability`, `requireModels(ctx)` keep their names. Core declares `interface ModelsCapability {}`; `@tulipes/mongoose` augments it with `get<T>(name)`, `has`, `names`, `ownerOf`, `connection`. `ModelDef`, `BootstrapFn`, `ModelStore` move to the provider. |
| Status/banner (Q4) | `BootHandle.connection` removed. `BootHandle.providers: readonly AcquiredStatus[]` where `AcquiredStatus = { capability, provider, label, ready }`; the banner prints label + readiness. The connection object is reachable as `ctx.models.connection` (provider-typed) for tests and scripts. |
| Instance identity (Q5) | Provider lists `mongoose` as a **peer dependency** (`^8`) and `@tulipes/core` as a peer; the app owns the single mongoose copy (already true — every generated production manifest declares it). Provider must not bundle or depend on mongoose directly. Verified by the two-boot and separately-installed fixtures. |
| `new module` (Q6) | Emits model + bootstrap files only when the app declares a `models` provider; otherwise emits a provider-free module and prints one line saying how to add models. `--model`/`--no-model` force either shape. |
| Bootstrap-only module without URI (Q7) | Becomes a declared requirement: a `bootstrap/` directory implies `requires: ["models"]` too, so the silent skip turns into the missing-provider diagnostic. |
| Compatibility (Q8) | Explicit breaking prerelease (`@tulipes/core` 0.10.0-rc.1). Interim (S09.2b): `@tulipes/core/db` **is** the provider specifier. After extraction it stays as a **migration stub**: its declaration exports only `@deprecated` never-typed names and its runtime throws a message naming `@tulipes/mongoose`. No bridge installs Mongoose through core. |
| Selection semantics | Installed ≠ selected. `MONGO_URI` alone never acquires anything. Selected + no `MONGO_URI` → provider reports a boot error. Selected + no consumers → still acquired (explicit intent), banner shows it. One provider per capability, one Mongoose connection per boot. |
| Metadata (S09.3) | Unsupported and documented as such; specs keep reading route schemas. |

## 2. Scenarios the interface must satisfy

The eight fixtures from plan §5.7, restated with the decisions above. "Stage"
says when each becomes executable (2b = S09.2b contract fixtures with a fake
provider; 4–9 = after extraction).

| # | Fixture | Positive | Negative | Stage |
|---|---|---|---|---|
| F1 | Core-only app | Imports/typechecks core, serves hello, generates offline specs | No `mongoose` resolvable from app or core | 2b (types, boot) / S09.5 (absence) |
| F2 | Explicit provider app | `providers.models` declared once; `ctx.models.get` typed in bootstrap/controllers | `ConfigCtx.models` rejected by types; `requireModels` on an un-acquired ctx throws naming the declaration | 2b |
| F3 | Required provider omitted | `requires: ["models"]` (or `models/`) discovered | Phase-4 error `module "x" requires capability "models" but package.json declares no provider for it` before any model import | 2b |
| F4 | Installed but unselected | Core-only app valid with the provider on disk and `MONGO_URI` set | Nothing connects; `ctx.models` undefined | 2b (fake) / S09.9 (real) |
| F5 | Broken provider setup | Connection/schema/bootstrap failures reported through `BootReport` | Every owned resource disposed within the deadline; original failure preserved | 2b (fake) / S09.4 (real) |
| F6 | Two independent boots | Separate stores/connections | Closing one leaves the other serving; plugins not doubled | S09.4/S09.9 |
| F7 | Runtime and offline CLI | `--runtime` boots the declared provider; `--offline` output identical to today | Offline never imports the provider specifier | 2b |
| F8 | Prior-contract upgrade | Documented import changes compile | `@tulipes/core/db` import gets the migration diagnostic at type and runtime level | S09.7 |

## 3. Candidate comparison

Both were developed against F1–F8 with the same consumer code (a bootstrap
task, a controller, a script).

| Criterion | A — models seam (selected) | B — keyed capability registry |
|---|---|---|
| New public concepts | `ModelsCapability` (augmentable, empty in core), `Provider` contract for provider authors, `providers`/`requires` declarations | Everything in A **plus** `Capability<T>` keys, `ctx.capabilities.get(key)`, generic `Provider<K>`; consumers must import a key object from the provider to read anything |
| Caller configuration | One `package.json` line | Same line; but consumers also import the key |
| Consumer code | Unchanged: `ctx.models.get<UserDoc>("User")`, `requireModels(ctx)` | `ctx.capabilities.require(models).get(...)` or a provider helper wrapping it — every consumer in `R24`/`R34` changes |
| Type/phase safety | Inherited: `ConfigCtx` already omits `models`; augmentation gives static typing when the provider is in the compilation | Static typing needs the key's generic; phase omission needs a second registry type per phase |
| Import isolation | Core's `.d.ts` never names Mongoose; augmentation lives in the provider's declarations | Same |
| Diagnostics | Missing capability named by the slot (`models`) | Named by the key's string; equivalent |
| Cleanup ownership | Internal per-boot list of acquired providers (core-owned) | Same list, exposed publicly |
| App-local resolution | Provider specifier resolved from the app's `package.json` (existing `importFromApp` pattern) | Same |
| Repeated-boot isolation | Per-boot list; provider state on `ctx` only | Same |
| Compatibility effort | Only the `@tulipes/core/db` import moves; `ctx.models`/`DatabaseCtx`/`requireModels` survive | All model consumers rewrite; generated/reference parity churn across nine files |
| Precedent in this codebase | `GlobalConfig` augmentation (`config/app.config.ts`, `sync`-generated `types/config.d.ts`) | None |

B's only concrete advantage would be a shared shape for queues/sockets later.
That shape is retained **internally** in A (the per-boot acquired list is keyed by
capability name and disposed in reverse order), so S10/S11 can add `queues`
and `sockets` slots with the same mechanism without ever having exposed a
generic registry. Rejected: B.

Also rejected — a boot option (`boot({ providers: [...] })`): executable
configuration that `sync`, offline `routes`/`spec` and `env:check` cannot read
without importing `app.ts`; worker and script entrypoints would each repeat it.

## 4. Declarations

### 4.1 Application: `package.json`

```jsonc
{
  "name": "my-api",
  "tulipes": {
    "providers": {
      "models": "@tulipes/mongoose"        // capability → module specifier
    }
  }
}
```

- Keys are capability names. Initial vocabulary: `models`. Unknown keys are a
  boot/inspection error (strict schema), so a typo cannot silently disable a
  provider.
- Values are module specifiers resolved with `createRequire(<app>/package.json)`,
  so a bare package name resolves from the app (never from a global CLI) and a
  relative path (`./providers/mongoose.js`) works for in-app providers and tests.
- Missing package → `provider "@tulipes/mongoose" for capability "models" cannot
  be resolved from <app> — install it`. Missing/invalid default export → names
  the expected shape. Both are phase-8 `BootReport` entries.
- The same file is already read by `inspectRoutes` (for `app.name`/`version`),
  so offline tooling gains the declaration at zero cost and without imports.

### 4.2 Module: `package.json` `tulipes` key

```jsonc
{ "tulipes": { "tier": "app", "dependsOn": ["auth"], "requires": ["models"] } }
```

- `requires?: string[]` added to `tulipesManifestSchema` (strict → typos fail).
- Implied requirement: a non-empty `models/` or `bootstrap/` collection adds
  `models` to the effective requirement set (explorer output, phase 5). The
  effective set is what phase 4/5 validation checks; explicit and implied are
  reported with the same message.
- Module dependency order (`dependsOn`) stays a separate concept from provider
  availability: `requires` never affects sorting.

## 5. Public types (core)

```ts
// @tulipes/core/boot — no Mongoose anywhere in this file's declaration graph
export interface ModelsCapability {}                       // augmented by the provider

export interface Ctx { /* … */ models?: ModelsCapability; }
export interface DatabaseCtx extends RuntimeCtx { models: ModelsCapability; }
export function requireModels(ctx: Pick<Ctx, "models">): ModelsCapability;

/** What a provider hands back the moment a resource exists. */
export interface AcquiredResource {
  dispose(): unknown | Promise<unknown>;
  forceDispose?(): unknown | Promise<unknown>;
  status(): { label: string; ready: boolean };
}

export interface ProviderContext {
  /** The live boot context after ACL; bootstrap tasks run against it. Core alone assigns the slot. */
  ctx: Ctx;
  rootDir: string;
  /** Discovered files for every module in load order; the provider decides what to import. */
  files: readonly ModuleFiles[];
  /** false in script mode and runtime inspection — same rule as today. */
  runBootstrap: boolean;
}

export interface Provider<Capability extends keyof ProviderCapabilities = keyof ProviderCapabilities> {
  contract: 1;
  capability: Capability;
  name: string;                                             // "mongoose" — banner and diagnostics
  /**
   * Call `own()` synchronously after creating any resource and BEFORE awaiting
   * anything that can fail or hang. Return the capability value, or undefined
   * after adding the failure to `report`.
   */
  acquire(
    ctx: ProviderContext,
    report: BootReport,
    own: (resource: AcquiredResource) => void,
  ): Promise<ProviderCapabilities[Capability] | undefined>;
}

/** Capability name → value type. Augmented alongside ModelsCapability. */
export interface ProviderCapabilities { models: ModelsCapability; }

export interface BootHandle {
  /* … */
  providers: readonly { capability: string; provider: string; label: string; ready: boolean }[];
}
```

Provider-side augmentation (`@tulipes/mongoose`):

```ts
import type { Connection, Model } from "mongoose";
declare module "@tulipes/core/boot" {
  interface ModelsCapability {
    get<T = unknown>(name: string): Model<T>;
    has(name: string): boolean;
    names(): string[];
    ownerOf(name: string): string | undefined;
    readonly connection: Connection;
  }
}
export interface ModelDef { name: string; schema: Schema; collection?: string }
export type BootstrapFn = (ctx: DatabaseCtx) => void | Promise<void>;
export default provider satisfies Provider<"models">;
```

Consequences:

- Static availability: an app that has `@tulipes/mongoose` in its compilation
  (any import of it — generated model files import `ModelDef` from it) sees the
  augmented `ModelsCapability`; a core-only app sees `{}` and cannot call
  `.get()`. Whether the provider is *selected* is still a runtime fact
  (dynamic configuration), diagnosed by `requireModels` and phase 4.
- `requireModels` message becomes actionable: `This module requires a database
  model store — no "models" provider is declared in package.json ("tulipes.providers.models")`.
- `ctx.models` is never set during config (`ConfigCtx` omits it) or offline
  inspection (`InspectionContext` omits it) — unchanged from today and already
  asserted by `context.test-d.ts`.

## 6. Phases, ownership and failure behavior

```
boot()
 ├─ 1–3  Environment
 ├─ 4    module graph  ──►  read app package.json: providers (strict) ─┐
 │                          manifest.requires (strict)                 │
 ├─ 5    exploration  ──►  effective requires (models/, bootstrap/) ◄──┘
 │                          ✗ requires ∖ providers ≠ ∅ → BootReport("providers"), throw   [F3]
 ├─ 6    config + i18n
 ├─ 7    ACL
 ├─ 8    providers, in declaration order (only "models" today)
 │        import(specifier from app)            ✗ unresolved / bad shape → report
 │        provider.acquire(ctx, report, own)
 │          ├─ createConnection(uri)            ← resource exists
 │          ├─ own({dispose, forceDispose, status})   ← ownership enters core's cleanup HERE
 │          ├─ await connection.asPromise()     ✗ report, return undefined
 │          ├─ registerModels (in order, aggregate)     ✗ report, skip bootstrap
 │          └─ runBootstrap if allowed && report clean  ✗ report
 │        ctx.models = value                    ← models readable from HERE
 │        report.throwIfAny("providers")
 ├─ 9    queues
 ├─ 9b–11b backend / worker
 └─ 12   onReady, banner (providers' status())

shutdown()  (unchanged order)
 onDrain ‖ http ‖ sockets ‖ workers → onShutdown (reverse) → queues → providers (reverse acquisition) → finish
failed boot: catch → shutdown() → owned providers disposed → original error (+ AggregateError on cleanup failure)
```

Rules:

- Core owns ordering, the single `Cleanup` deadline and `BootReport`; the
  provider owns connection creation, compilation, bootstrap policy and
  driver-specific close/force-close. `own()` may be called at most once per
  `acquire`; a second call is a provider bug reported as such.
- A provider that throws (instead of reporting) is caught by core, recorded as
  `provider "mongoose" threw during acquisition: …`, and any owned resource is
  still disposed — the same guarantee as today's `catch` (`R6`).
- `dispose` runs after `queues`, before `finish()`, with `forceDispose` as the
  forced path (`R5`). Multiple providers dispose in reverse acquisition order.
- Repeated boot: the acquired list is created inside `boot()`; nothing is
  module-global. Two handles in one process own two connections (`F6`).
- Script mode and runtime inspection pass `runBootstrap: false`; worker and
  backend pass `true` (§3.3 of the inventory).

## 7. Provider package

- Name `@tulipes/mongoose`, version `0.1.0-rc.1` in the workspace; to be
  published alongside the core/spec candidates that ship the contract (final
  ranges are release outputs — the workspace peer range is `>=0.9.0-rc.3 <1`
  until core's next version is chosen).
- `peerDependencies`: `@tulipes/core`, `mongoose ^8`. `dependencies`: none —
  enforced by `artifacts.mjs verify`. `devDependencies` for tests only.
- Exports: `.` (default `provider`, `ModelDef`, `BootstrapFn`, `ModelStore`), no
  subpaths. Declarations augment `@tulipes/core/boot`.
- Reads `MONGO_URI` exactly as today (declared by the app's sys core module —
  the provider does not declare variables; the `tulipes-env-variable` rule
  still holds). Selected without a value → `provider "mongoose" is selected but
  "MONGO_URI" is not declared/set`.
- Model registration, duplicate-owner diagnostics, `instanceof Schema`, collection
  override, bootstrap ordering and the 5 s server-selection timeout move verbatim
  from `src/db/database.ts` (`R10`, `R11`). The four integration tests move with it.
- Global plugins remain application code (`R23`); the provider compiles models
  on `connection.model`, which honours `mongoose.plugin` on the shared instance.

## 8. Tooling and generators

| Tool | Behavior |
|---|---|
| `inspectRoutes` (offline) | Parses `tulipes.providers` and every `requires`; reports unknown capability keys and unmet requirements; never imports a specifier. Uninstalled provider package is **not** an offline error (service-free fixture retained). |
| `routes --runtime` / `spec --runtime` | `boot({ inspect: true })` → same phase 8, `runBootstrap: false`. |
| `sync` | Unchanged output; `KnownVariables` still comes from `meta.variables.json`. No accessor generation (backlog S09.1-doc closed by deleting the comment). |
| `env:check` | Unchanged. |
| `init --preset production` | Adds `providers.models` to the root manifest, `@tulipes/mongoose` to root and model-owning module dependencies, rewrites the six model files and two bootstrap files to import from `@tulipes/mongoose`. Reference `example/` receives the same edits (parity diff). |
| `init --preset minimal` | Unchanged; must not gain the provider or `mongoose`. |
| `new module` | See Q6. |
| `scripts/artifacts.mjs`, `scaffold-smoke.mjs`, CI | Three archives; a **core-only launcher** for the minimal job (S09.8). |

## 9. Executable fixtures for S09.2b

Type fixtures (`packages/core/tests/providers.test-d.ts`, `tsc -p tsconfig.tests.json`):

- `ConfigCtx.models` and `InspectionContext.models` rejected (existing).
- `ModelsCapability` without augmentation exposes no `get` (`@ts-expect-error`).
- A local augmentation (test-only) makes `requireModels(ctx).get<Doc>("X")` typed.
- A `Provider<"models">` object with a wrong `capability` or missing `contract` is rejected.
- `BootHandle.connection` no longer exists (`@ts-expect-error`).

Runtime fixtures (`packages/core/tests/providers.test.ts`, fake provider written
into the temp app, no Mongoose):

- F2: declared relative provider acquires; `ctx.models` set; `handle.providers`
  reports its label/ready; `requireModels` returns it.
- F3: `requires: ["models"]` with no declaration → boot rejects with the phase-4
  message before the module's config or model file is imported (asserted with a
  file that throws on import).
- F3′: implied requirement from `models/` and from `bootstrap/` alone.
- F4: provider resolvable on disk but undeclared, `MONGO_URI` set → not imported
  (import-side-effect sentinel file untouched), `ctx.models` undefined.
- F5: provider calls `own()` then fails → `dispose` called exactly once, boot
  rejects with the reported message; provider that throws → same; `own()` twice
  → reported.
- F6 (fake): two boots → two distinct values, disposing one leaves the other.
- F7: `inspectRoutes` on an app declaring a **non-existent** specifier succeeds;
  unknown capability key and unmet `requires` are reported offline.
- Strict schema: `"tulipes": { "providers": { "modles": … } }` and
  `"requires": ["modles"]` both fail with the path in the message.

### 9.1 What ran (S09.2b, 2026-09-11)

No legacy path was kept. Instead the built-in loader became the first provider
(`packages/core/src/db/provider.ts`, default export of `@tulipes/core/db`), the
production generator and the reference app declare it, and the contract holds
in full: an undeclared `MONGO_URI` connects nothing, a declared provider without
one is a boot error, `BootHandle.connection` is gone.

| Fixture | Evidence | Result |
|---|---|---|
| Type fixtures | `packages/core/tests/providers.test-d.ts` (`yarn test:types`) — phase omission, `handle.connection` removed, `Provider` contract/capability/resource shape rejected | pass |
| F2 acquire/expose/dispose | `providers.test.ts` "declared provider is acquired once…" — `ctx.models`, `handle.providers`, config sees no slot, dispose logged once | pass |
| F3 explicit requirement | "…refused before any module code is imported" — throwing `module.config.js` never runs | pass |
| F3′ implied requirement | "models/ and bootstrap/ directories imply…" — both directories, model file never imported | pass |
| F4 installed but undeclared | "…never imported, even with MONGO_URI set" — throwing provider file untouched, `ctx.models` undefined | pass |
| F5 failure after `own()` | report / throw / silent-return → dispose logged, boot rejects with each message | pass |
| Provider errors | `own()` twice, contract 2, capability mismatch, unresolvable specifier, malformed export | pass |
| F6 two boots | separate values; disposing one leaves the other; two disposals total | pass |
| Typos | `providers.modles` and `requires: ["modles"]` fail with the path in the message | pass |
| F7 offline | `inspectRoutes` succeeds with an **uninstalled** declared specifier and a throwing provider file; unmet `requires` reported offline | pass |
| Real provider, live database | `database.integration.test.ts` (4 tests, `@tulipes/core/db` declared): registration failure releases the connection, schema throw outside the report, inspection skips bootstrap, forced cleanup bounded by the deadline (step now named `provider mongoose`) | pass, local Mongo |
| Whole suite | 235 core/spec tests in 24 files with `REQUIRE_INTEGRATION_TESTS=1`; example 55 tests; `yarn test:types`; core and example typecheck | pass, local services |
| Packed | `artifacts.mjs prepare`; generator/reference parity diffs; minimal smoke (install, sync, typecheck, tests, offline specs, backend/shutdown, `ctx.models` undefined); production offline smoke with sockets denied | pass |
| Packed production runtime | `scaffold-smoke.mjs … production` with local services — install, sync, typecheck, tests, offline specs, backend + worker booting through `@tulipes/core/db` resolved from `dist/`, login, start and PM2 smokes | pass |

Not executed at 2b: packed **absence** of Mongoose (F1 negative, now §9.2);
the prior-contract upgrade fixture (F8, now §9.2); two-boot plugin identity
with the real driver (S09.9).

### 9.2 Extraction evidence (S09.4–S09.6, S09.8; 2026-09-11)

| Claim | Evidence | Result |
|---|---|---|
| Runtime moved (S09.4) | `packages/mongoose/src/{database,model-store,provider,index}.ts` — the loader verbatim, `own()` registered in `onConnection` before `asPromise()`; the four integration tests moved with it and pass against local Mongo | pass |
| Core declarations free of Mongoose (S09.5) | `artifacts.mjs verify` now greps every packed core `.d.ts` for `from "mongoose"` and refuses; packed core: 0 hits, `dependencies` without mongoose; `build` scripts clean `dist/` first (a stale `dist/db/database.d.ts` had survived `tsc` and shipped) | pass |
| Packed absence (F1 negative) | `scaffold-smoke.mjs minimal` resolve probe: `mongoose`, `mongodb`, `bson`, `@tulipes/mongoose` unresolvable from the app, from core's directory and from the launcher (`reports/scaffold-minimal/resolve.json`) | pass |
| Core-only launcher (S09.8-isolation) | Smoke launcher installs only the core archive; the production app resolves the provider from its own `node_modules`, never through the launcher | pass |
| Consumers migrated (S09.6) | Generator and `example/`: root manifest declares `@tulipes/mongoose`, model-owning modules depend on it, six model files import `ModelDef` from it; parity diffs identical; `tulipes new module` provider-aware (`cli.test.ts`) | pass |
| Migration stub and upgrade fixture (S09.7) | `scripts/upgrade-smoke.mjs` (CI job `upgrade`): the production app generated by the **published** core 0.9.0-rc.3 archive, moved onto the archives under test. Unmigrated: refused in the `providers` phase before any module import with no connection attempted; declaring `@tulipes/core/db` gets the "no longer contains" diagnostic; `tsc` fails with `has no exported member 'ModelDef'` **and** `Property 'get' does not exist on type 'ModelsCapability'` — the packed core-only type proof. Migrated per MIGRATING.md (1 root manifest, 4 module manifests, 6 imports): installs, syncs, typechecks, `routes`/`spec --offline` with sockets denied, and the first boot failure is the provider's own `database connection failed` | pass |
| Three archives (S09.8) | `artifacts.mjs` inventory `core, spec, mongoose`; provider archive verified to carry no `dependencies` and a `mongoose` peer; `artifacts.test.ts` updated | pass |
| Whole suite | 236 core/spec/mongoose tests with services (`REQUIRE_INTEGRATION_TESTS=1`), coverage 84/72/87/86, `test:types`, workspace typecheck, example 55 tests, generated/reference and template parity, packed minimal smoke, packed production offline and runtime (backend, worker, login, PM2) smokes | pass |

Core-only type proof: with the provider out of the repository tests' program
`requireModels(ctx).get` stopped compiling (observed during the move); the
shared test program includes `packages/mongoose/tests`, so that assertion
lives in the packed minimal typecheck rather than in `context.test-d.ts`.

## 10. Compatibility table

| Today | After | Migration |
|---|---|---|
| `import type { ModelDef } from "@tulipes/core/db"` | `from "@tulipes/mongoose"` | Rewrite import; stub throws/deprecates |
| `import type { BootstrapFn } from "@tulipes/core/db"` | `from "@tulipes/mongoose"` | Same |
| `import { ModelStore } from "@tulipes/core/db"` | `from "@tulipes/mongoose"` (rarely needed) | Same |
| `import type { DatabaseCtx } from "@tulipes/core/boot"` | unchanged | — |
| `requireModels(ctx)` / `ctx.models!.get()` | unchanged; typed when the provider is in the compilation | — |
| `handle.connection` | `ctx.models.connection` (provider-typed) or `handle.providers[i]` status | Rewrite |
| `MONGO_URI` present ⇒ connect | `tulipes.providers.models` declared ⇒ connect; URI still required | Add one line to `package.json` |
| Module with `models/` | implied `requires: ["models"]` | — (explicit only for consumers without model files) |
| `mongoose: ^8` in module manifests | unchanged + `@tulipes/mongoose` where models are declared/consumed | Add dependency |
| `tulipes new module` | provider-aware | — |
| `@tulipes/core/db` subpath | migration stub | Remove usages |

Maintained old line: 0.9.0-rc.x on dist-tag `next` remains installable; the
upgrade fixture for S09.7 is the packed 0.9.0-rc.3 production starter upgraded
to the new core + provider by applying exactly this table.

## 11. Deferred, consciously

- Multiple connections per boot, connection pools per module, read replicas.
- Model metadata for specs (S09.3 records "unsupported").
- Queue/socket extraction reuse of the internal acquired list (S10/S11).
- `sync`-generated typed model accessors (separate feature, if ever).
- A provider "disabled" flag or environment-driven selection (`TULIPES_PROVIDERS`);
  selection is a source-controlled declaration by design.

None of these change the registration point, the `ModelsCapability` seam or
the ownership sequence, so the first extraction cannot be invalidated by them.
