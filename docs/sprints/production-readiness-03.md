# Sprint 03 — Dependency inventory and first provider design

Status: planning complete; S09.1a (register, harness, baseline) recorded in
[docs/design/mongoose-dependency-inventory.md](../design/mongoose-dependency-inventory.md);
S09.1b and S09.2 are not yet complete. Prepared on 2026-09-11 against source `3d56aed`.
This is the execution plan for those two items, followed by a handoff to the
remaining Mongoose extraction tasks. It does not implement or release a provider.

Program: [S09 task definitions](production-readiness-task-report.md#s09--mongoose-provider-and-capability-contract).
Prerequisite: [Sprint 02 acceptance](production-readiness-02-evidence.md#ci-acceptance--passed-on-2026-09-11),
including early drain notifications, offline declarations and retained security
regressions. Accepted runtime/package source is `37dbca7`; `3d56aed` records its
acceptance without changing runtime code.

## 1. Intended result and scope

Produce enough evidence and a precise enough interface to extract Mongoose without
weakening boot ownership, application behavior or offline inspection. A minimal
application must eventually **install, import, typecheck, inspect and boot without
Mongoose**. Skipping a database connection is already possible and does not meet
the installation requirement.

The first two items deliver:

1. **S09.1:** a complete coupling register, reproducible baseline measurements and
   a file-by-file extraction checklist.
2. **S09.2:** a selected provider interface, ownership/phase rules, compatibility
   decision, executable type examples and an implementation/verification sequence.

The design should make the database provider a deep module: connection acquisition,
model validation/compilation, bootstrap policy and database disposal should sit
behind a small interface. Core retains orchestration and aggregate diagnostics.
Concrete Mongoose types belong to the provider and its consumers.

Queues, sockets, translation, CLI packaging and auth/settings library extraction
remain later workstreams. Their existing types and dependencies can remain during
Sprint 03; the narrower guarantee is removal of Mongoose coupling from core.
Do not introduce a generic ORM, query abstraction, provider marketplace or general
plugin bus. No cookie adaptation, deployment, package publication, merge or
visibility change is part of this plan.

## 2. Working agreement and ownership

| Responsibility | Owner role | Required result |
|---|---|---|
| Inventory, measurement harness and interface fixtures | Implementing engineer | Reproducible evidence with source and archive identity |
| Interface and compatibility decision | Maintainer with implementing engineer | Chosen contract, rejected alternatives and migration cost |
| Generated/reference application migration assessment | Implementing engineer | Complete consumer list and retained behavior matrix |
| Supported CI and archive evidence | Engineer/release maintainer | Successful jobs tied to the exact selected source/archives |
| Provider version/package naming and any eventual publication | Release maintainer | Explicit release decision outside this planning change |

These are responsibility assignments, not invented personnel. Routine investigation
and reversible local design fixtures can proceed under the sprint. Record decisions
in the design document; resolve ordinary implementation details without adding
approval gates. Escalate only an unresolved compatibility/product choice that
materially changes the supported contract.

Before each change set, read this tracker, identify its acceptance criteria and
preserve unrelated changes. Update actual results and outstanding tasks, run the
checks appropriate to that change, and commit with its S09 identifier. Do not mark
an investigation complete merely because a document or empty provider package exists.

## 3. Starting evidence from the repository

The table is an initial source reading, not the completed S09.1 inventory. Extend it
to every relevant import, declaration, generated consumer and installed dependency.

| Area | Confirmed current behavior | Inventory/design consequence |
|---|---|---|
| [Core package](../../packages/core/package.json) | Direct `mongoose` dependency; source and published `./db` exports | Inspect both source and emitted exports; removing one import cannot remove installation cost |
| [Boot driver](../../packages/core/src/boot/boot.ts) | Static database-loader import; public `BootHandle.connection` uses Mongoose `Connection`; phase 8 acquires models before queues | Extract runtime import and public type together; preserve phase ordering |
| [Database loader](../../packages/core/src/db/database.ts) | Reads `MONGO_URI`, creates a connection, reports ownership before awaiting connection, validates schemas, compiles models, runs bootstrap | Provider must own these details while core preserves partial-failure cleanup |
| [Model store](../../packages/core/src/db/model-store.ts) | `get<T>` returns Mongoose `Model<T>`; owner/name lookup supports duplicate diagnostics | Move concrete store types; do not replace them with an untyped query facade |
| [Context contracts](../../packages/core/src/boot/contracts.ts) | `Ctx.models`, `DatabaseCtx` and `requireModels` expose `ModelStore` | Decide replacement imports and phase-specific access; runtime checks cannot be replaced by type assertions |
| [Startup banner](../../packages/core/src/boot/banner.ts) | Reads Mongoose connection host, port, database name and readiness | Replace direct driver inspection with bounded status data or provider-owned formatting |
| [Module discovery](../../packages/core/src/modules/manifest.ts) / [exploration](../../packages/core/src/modules/explorer.ts) | Strict manifest schema; model/bootstrap files discovered by convention | Any new declaration needs schema/diagnostic support; distinguish declaration discovery from executing model files |
| [Runtime inspection](../../packages/core/src/cli/inspection.ts) / [offline inspection](../../packages/core/src/boot/inspect.ts) | Separate runtime and offline paths | Explicit provider selection must reach runtime tooling while offline avoids provider acquisition/imports |
| [CLI sync](../../packages/core/src/cli/sync.ts) | Generates environment declarations and config return types without executing module code | Preserve import-free generation; typed per-model accessors are not currently generated despite the model-store comment |
| [Spec extraction](../../packages/spec/src/extract.ts) | Builds descriptions from declared routes and schemas | Do not invent connected-model metadata as a prerequisite for current specs |
| [Production core config](../../example/modules/core/module.config.ts) | Registers global Mongoose plugins at module import before model compilation | Preserve timestamp/soft-delete behavior and test repeated boots and Mongoose instance identity |
| [Starter generator](../../packages/core/src/cli/init.ts), [new-module generator](../../packages/core/src/cli/new-module.ts), [preset tests/templates](../../packages/core/src/cli/minimal.ts) | Generate model schemas, dependencies, helpers and tests | Inventory emitted files, not only generator imports; decide new-module behavior for provider-free apps |
| [Artifact script](../../scripts/artifacts.mjs) | Hardcodes `core`/`spec` and exactly two archives; preflights immutable-version conflicts before publishing | S09.8 must support the chosen inventory without weakening identity/digest checks or publication preflight |
| [Installed smoke](../../scripts/scaffold-smoke.mjs) | Installs all archives into the CLI launcher and adds archive resolutions to the app | Future absence proof needs a truly core-only fixture; an all-provider launcher can hide dependency mistakes |

S09.1 must also search documentation, lockfiles, test fixtures, generated `.d.ts`,
module barrel exports, boot helpers and scripts. Count both direct references and
indirect paths from public entrypoints. A search with zero literal `mongoose`
imports is insufficient if a public type still reaches its declarations.

## 4. S09.1 — Inventory and baseline measurements

### 4.1 Freeze the measurement baseline

- [ ] Record source SHA, clean/dirty state, package versions, archive digests,
  lockfile identity, Node/Yarn versions, OS/architecture and service versions.
- [ ] Use committed source and freshly verified archives. Retain Sprint 02's
  accepted CI artifacts as historical evidence; do not relabel them as a new run.
- [ ] Create disposable fixtures outside the workspace, with no parent workspace
  resolution or inherited `NODE_PATH`. Use dedicated MongoDB/Redis data only.
- [ ] Record commands and environment policy without tokens, passwords or service
  credentials. Store raw reports under ignored `reports/s09-inventory/` and put
  stable summaries and archive identities in documentation.

### 4.2 Build the coupling register

Begin with a batched repository search, then follow each reference to callers and
published declarations. Example read-only starting commands:

```sh
rg -n 'mongoose|ModelStore|ModelDef|DatabaseCtx|requireModels|initDatabase' packages example scripts docs
rg -n 'MONGO_URI|modelFiles|bootstrapFiles|connection|registerBasePlugins' packages/core/src example
rg -n 'mongoose|mongodb|bson|@tulipes/core/db' yarn.lock packages example
rg --files packages/core/tests packages/spec/tests example/tests
```

Classify each finding rather than treating every textual hit as runtime coupling.
Use one register row per contract or dependency path, with these fields:

| Field | Required content |
|---|---|
| Location and callers | File/export, callers and generated/reference equivalents |
| Coupling kind | Runtime import, type-only import, package dependency, convention, lifecycle, test or documentation |
| Current behavior | What the caller relies on, including phase, errors and ownership |
| Proposed owner | Core, Mongoose provider, application or tooling |
| Change disposition | Move, adapt, retain, remove or explicitly defer |
| Compatibility impact | Replacement import/configuration and affected supported consumers |
| Evidence | Retained test or new contract scenario needed to prove the change |
| Closure | Unresolved question, decision and downstream S09 task |

Required investigations:

- [ ] Trace `@tulipes/core` and every public subpath through runtime imports and
  emitted `.d.ts`; include `BootOptions`, `BootHandle`, all context types and `./db`.
- [ ] Trace every path installing Mongoose, MongoDB driver packages and shared
  transitive packages. Attribute shared dependencies without double-counting them.
- [ ] Map connection ownership on successful boot, connection failure, schema
  compilation failure, bootstrap failure, later boot failure and repeated shutdown.
- [ ] Record model ordering, duplicate ownership, collection naming, schema
  validation and the `instanceof Schema` dependency on a consistent Mongoose copy.
- [ ] Map bootstrap behavior in backend, worker, script and runtime inspection.
  Include bootstrap-only modules, zero-model applications with a URI, and models
  declared without a URI; record current outcomes before deciding changes.
- [ ] Map production plugins and model consumers in auth/users/settings/hello,
  including audit write concern, refresh update pipelines, credentials, TTL/index
  assumptions and soft-delete/timestamp behavior.
- [ ] Map CLI entrypoints: generated app boot, script/worker startup, `routes`,
  `spec`, `sync`, `check`, new-module output and app-local package resolution.
- [ ] Determine whether any real consumer needs model documentation today. Keep
  route-schema metadata as the source for existing OpenAPI/Postman output.
- [ ] Identify hardcoded package inventories, peer ranges, archive resolutions,
  published exports, license checks and release-order assumptions.
- [ ] Identify all migration examples and existing tests to move or retain; do
  not rewrite unrelated queue/socket behavior during this inventory.

### 4.3 Measure distinct installation shapes

Use separate fixture roots and retain their generated package manifests/lockfiles.
Do not use the repository's hoisted workspace tree to claim installed absence.

| Fixture | What to install/run | Purpose |
|---|---|---|
| A — Core package only | Packed core plus explicit harness prerequisites | Attribute core's transitive installation cost and root/subpath imports |
| B — Minimal starter | Fresh packed-generated minimal app, including its normal spec/development tools | Measure the actual current minimal user journey |
| C — Production starter | Fresh packed-generated production app with dedicated services | Measure provider-required behavior and application-owned dependencies |
| D — CLI launcher | Existing packed smoke launcher separately from its generated app | Expose dependencies introduced by tooling rather than the application |

For each applicable fixture record:

- [ ] Compressed archive bytes, unpacked package bytes and total installed bytes.
- [ ] Unique installed name/version pairs and physical copies; distinguish runtime,
  development, peer and optional dependency reasons.
- [ ] Mongoose's reachable dependency graph, including dependencies shared with
  other consumers. Report logical bytes consistently; record `du` separately if
  filesystem allocation is useful, since allocation varies by platform.
- [ ] Resolve/import outcomes from the fixture's own module context for Mongoose,
  MongoDB and BSON. After extraction, explain any remaining shared transitive
  package rather than assuming all MongoDB-related names must vanish everywhere.
- [ ] Install durations for a fresh package-manager cache and a warm cache. Isolate
  caches; do not clear the developer's global cache. Record network/registry
  conditions, failures and retry policy; install timing is not boot timing.

Measurement summaries need explicit “not measured” entries when a metric is absent.
No size reduction or percentage improvement is claimed until the comparable
post-extraction run exists.

### 4.4 Measure startup without conflating phases

Implement a small disposable-process measurement harness as part of S09.1; do not
turn the startup banner's elapsed time into the only benchmark. Record at least:

| Measurement | Start / end | Constraints |
|---|---|---|
| Public import | New Node process before dynamic import / import resolved | Measure root and `./boot`; report tsx/tooling overhead separately |
| Minimal readiness | Process spawn / first successful `/health` and `/api/v1/hello` | No application services; use the installed app's normal runtime |
| Offline description | CLI process spawn / deterministic documents written | Connections denied, runtime secrets absent; installation is outside the timed interval |
| Production backend readiness | Process spawn / successful HTTP readiness check | Prestarted dedicated services; report seeding/index effects separately |
| Worker readiness | Process spawn / worker ready with registered processors | Dedicated services; distinguish registration from an actually completed job |
| Shutdown | Shutdown initiation / process exit or reported failure | Include healthy open SSE and ordinary work under existing deadlines |

For startup measurements, run one documented first run, three warm-ups and twenty
fresh-process samples per timed scenario. Report median, observed range and p95
with sample count; twenty samples provide a coarse comparison, not a load-test
claim. Run the same harness and runner conditions before/after extraction. Separate
first database initialization from steady-state boot; do not silently remove slow
or failed samples. Record a smaller sample set as incomplete if time prevents the
planned run. Installation timing can use three fresh-cache and three warm-cache
runs, with each result retained rather than overstating statistical confidence.

Capture RSS at readiness where practical; avoid mixing peak RSS from a compiler
or package manager with the app process. Do not set a universal speedup target.
Investigate material regressions and explain whether package separation or changed
fixture conditions account for them.

### 4.5 S09.1 deliverables and exit criteria

Planned outputs, created when this work executes:

- `docs/design/mongoose-dependency-inventory.md`: complete coupling register,
  measurement methodology/results and affected-file checklist.
- Ignored `reports/s09-inventory/`: fixture manifests, dependency paths, archives,
  raw measurements and logs, identified by source SHA.
- A reproducible measurement harness in `scripts/` if reuse for S09.10 justifies
  tracking it; keep measurements out of application runtime code.

S09.1 is complete only when another engineer can reproduce the baseline, every
public/runtime/generated path has a disposition, and unresolved design questions
have an owner and S09.2 decision entry. Numbers are evidence, not a quota to hit.

## 5. S09.2 — Select the provider interface

### 5.1 Compare two concrete designs

Develop two small alternatives against the same consumer scenarios. These are
candidate designs, not approved package names or supported interfaces.

| Candidate | Shape | Main question |
|---|---|---|
| A — One models acquisition seam | Core accepts an optional model-provider registration; provider owns typed accessors and database implementation | Can one explicit slot cover current boot/tooling needs without leaking Mongoose or proliferating special cases? |
| B — Small keyed capability seam | Core owns a per-boot registry of typed capability keys and owned cleanup; Mongoose supplies one adapter | Does a reusable registry reduce demonstrated caller complexity enough to justify extra public concepts? |

Start with A as the preferred smaller design. Adopt B only if the same fixtures
show a concrete advantage; future queue/socket possibilities alone are not proof.
Omitted-provider operation is a required mode, not a reason to ship a fake ORM.
Do not create a second database adapter merely to justify abstraction.

Compare both on public concepts, caller configuration, diagnostic quality,
phase/type safety, import isolation, cleanup ownership, app-local resolution,
repeated-boot isolation and compatibility effort. Write at least one rejected
alternative and why it failed those criteria. Prefer complexity concentrated in
one provider implementation over casts or repeated setup spread across callers.

### 5.2 Resolve the application selection contract

- [ ] Choose one authoritative application registration point. Compare a boot
  option with a discoverable app declaration; ensure backend, worker, scripts and
  runtime CLI inspection all read the same selection.
- [ ] Specify when registration is discovered and when its runtime code is imported.
  Offline inspection and `sync` must not execute a provider factory, module config,
  model schema or global Mongoose plugin just to learn what is selected.
- [ ] If the declaration contains a module specifier, define app-root resolution,
  missing package/export errors and when import is deferred. If it uses executable
  configuration, explain how offline tooling avoids importing that configuration.
- [ ] Installing a provider must not enable it implicitly. A leftover `MONGO_URI`
  must not silently acquire a provider in the new contract; document any change
  from today's URI-driven behavior.
- [ ] Decide selected-but-unused behavior, selected-without-URI failure, duplicate
  registrations and unsupported provider/core version diagnostics.
- [ ] State the initial supported count: one Mongoose provider/connection per boot
  unless the inventory demonstrates an existing multi-connection requirement.

### 5.3 Resolve module requirements and model declarations

- [ ] Choose explicit, static module capability requirements and/or a rule for
  discovered `models/*.model.ts`. Model consumers without local model files must
  also be able to declare their requirement.
- [ ] Specify how strict manifest validation reports typos and unknown requirements.
  Keep module dependency order distinct from provider capability availability.
- [ ] Reject missing required providers before importing model files or exposing
  routes. Diagnostics identify the module, capability and corrective action.
- [ ] Define whether offline inspection validates selected/required declarations
  while permitting an uninstalled runtime provider. Whichever policy is chosen,
  retain a service-free production offline fixture and explain resolution rules.
- [ ] Preserve model name/schema/collection semantics, dependency-ordered loading
  and duplicate-owner diagnostics. Decide where `ModelDef` and bootstrap types move.
- [ ] Keep the provider's schema/model interfaces Mongoose-specific. Do not emulate
  its query behavior through `unknown`, broad assertions or a thin generic repository.

### 5.4 Define phases, ownership and failure behavior

Core owns the boot driver's ordering, the shared shutdown deadline and BootReport.
The provider owns connection creation, model compilation and driver-specific close/
force-close behavior. Resource ownership must be registered immediately after
acquisition, before awaiting any operation that can fail or remain pending.

| Phase/mode | Required contract |
|---|---|
| Declaration discovery/offline | Read only allowed static declarations; no connection, schema/plugin import or lifecycle execution |
| Config | Environment/module config available; connected models unavailable; define pre-compilation plugin configuration |
| Acquisition | Core invokes the selected provider after required prior phases; connection ownership recorded before awaiting readiness |
| Model registration | Compile all valid declarations in order; aggregate actionable issues and avoid bootstrap after registration failure |
| Bootstrap | Preserve backend/worker execution; script/runtime inspection skip according to the existing contract |
| Backend/worker runtime | Provider models available before model-dependent routes, queue handlers and readiness hooks |
| `onDrain` | Stop long-lived admission/output while database dependencies remain available to draining requests/jobs |
| Traffic drain and `onShutdown` | Preserve current dependency availability for consumers and reverse module disposal |
| Provider disposal | Run after dependent consumers, under the same total deadline; include forced cleanup and aggregate failures |
| Failed startup | Attempt cleanup for every acquired resource; preserve the original boot failure plus cleanup diagnostics |
| Repeated boot/shutdown | Per-boot ownership; one shutdown operation; no previous boot's store or connection reused accidentally |

Draw a sequence diagram in the design deliverable covering successful boot and
failed acquisition. Identify the exact point where ownership enters core's cleanup
path and where models become readable. Avoid introducing a provider shutdown loop
that competes with existing `Cleanup` or extends its deadline independently.

### 5.5 Define the public type and access contract

- [ ] Core's published declaration graph must contain no Mongoose `Connection`,
  `Schema`, `Model`, `ModelStore` or indirect provider declaration dependency.
- [ ] The provider exports concrete model access and, where supported, connection
  access. Decide the replacements for `ctx.models`, `requireModels`, `DatabaseCtx`
  and `BootHandle.connection`; keep migration examples side by side.
- [ ] Decide how provider state is scoped to a boot context. Consider generic
  capability typing, opaque storage or provider-owned accessors; prove isolation
  instead of relying on process-global module state.
- [ ] A runtime accessor must diagnose missing initialization, not simply cast a
  generic context. Configuration and offline contexts must not expose connected
  models as available.
- [ ] Specify whether availability can be known statically for a typed app or only
  narrowed at runtime for discovered modules. Do not promise compile-time rejection
  of a missing provider when configuration is loaded dynamically.
- [ ] Replace banner connection inspection with an appropriately small status
  interface. Avoid exposing URI secrets or reintroducing the driver via status types.
- [ ] Verify emitted provider/core declarations from packed installations; workspace
  devDependencies and `skipLibCheck` must not mask a core declaration dependency.

### 5.6 Resolve plugin, metadata and compatibility policy

**Plugins and instance identity.** Preserve app-owned timestamp/soft-delete plugins,
bootstrap indexes and their execution order in backend/worker/script. Decide how
provider and schema declarations share compatible Mongoose instances. Review
peer/dependency ranges and the current global registration guard; test two boots
in one process and separately installed applications. Do not silently move editable
application policy into core or assume workspace hoisting guarantees identity.

**Metadata.** Current specs need route schemas, not connected-model introspection.
Preferred initial decision: leave model-documentation extraction unsupported and
explicitly documented unless S09.1 identifies a real consumer. If metadata is
needed, specify pure declarations without live models, dummy connections or runtime
plugins. This decision feeds S09.3; it must preserve deterministic offline output.

**Compatibility.** Produce an export/config migration table for `@tulipes/core/db`,
`DatabaseCtx`, `requireModels`, `ctx.models`, `BootHandle.connection`, model definitions,
bootstrap functions, provider selection and generated dependencies. Compare an
explicit breaking prerelease path with a separately installed compatibility bridge.
A bridge may not reinstall Mongoose through the claimed provider-free core path.
Record the maintained old line and upgrade fixture before selecting versions.
Provider package name and core/provider/spec ranges remain design outputs.

**Tooling.** Define how `sync` represents provider configuration without importing
runtime code. Do not add model accessors merely to satisfy an outdated comment.
Specify new-module output when the target app omits the provider: a clear failure,
an explicit model option, or a deliberate provider-free output. Avoid silently
installing the provider or leaving broken model imports. Keep default minimal and
explicit production presets comprehensible.

### 5.7 Exercise the interface before extracting runtime

Create small fixtures using the proposed interface. Sketches are insufficient to
prove TypeScript behavior: run executable compile fixtures with positive examples
and `@ts-expect-error` checks for actual invalid use. A minimal local implementation
of the proposed contract may be needed; do not publish an empty provider package.

During S09.2, exercise type availability, registration validation, missing-capability
diagnostics and per-boot ownership against an isolated contract fixture. The table
also defines the eventual end-to-end expectations: real provider acquisition,
packed dependency absence, production migration and old-contract upgrades complete
under S09.4–S09.9. Current core still installs Mongoose, so a contract fixture cannot
establish packed absence. Record which expectations were executed at each stage;
do not require full extraction merely to finish design or label future tests passed.

| Fixture | Positive behavior | Negative behavior / assertion |
|---|---|---|
| Core-only app | Imports and typechecks core, serves hello, generates offline specs | No Mongoose resolution/import possible from app or core entrypoints |
| Explicit provider app | Provider selected once; typed model query and bootstrap available in permitted phases | Wrong-phase access rejected by types; runtime missing/unready capability diagnosed |
| Required provider omitted | Static module requirement is discovered | Actionable module error before model import, controller acquisition or listening |
| Provider installed but unselected | Core-only app remains valid | Presence on disk alone does not connect/register models |
| Broken provider setup | Connection/schema/bootstrap/later-hook failures reported | All acquired resources owned and cleanup attempted within deadline |
| Two independent boots | Separate stores/connections and fresh lifecycle state | Closing one boot does not invalidate the other or multiply global plugin effects |
| Runtime and offline CLI | Runtime loads the same selection as application boot; offline output matches | Offline cannot import forbidden provider runtime, plugins or services |
| Prior-contract upgrade | Documented import/config changes produce working model access | Unsupported old usage gets the selected migration diagnostic |

Reuse existing tests where they already exercise the contract. Add tests for
observable behavior and ownership, not assertions that mirror private registry
implementation. Keep meaningful failure regressions with the owning implementation
change; a documentation-only plan does not need a full runtime suite rerun.

### 5.8 S09.2 deliverables and exit criteria

Planned outputs:

- `docs/design/mongoose-provider-design.md`: selected interface, alternatives,
  registration/requirement rules, phase sequence, ownership, type examples,
  diagnostics, plugin policy, metadata decision and compatibility table.
- Executable interface/type fixtures and narrowly scoped contract code where needed.
- Updated extraction checklist assigning every S09.1 coupling to S09.3–S09.10.

Exit only when all required scenarios have a specified outcome, public types can
express the selected contract, ownership is unambiguous on every failure path,
and no unresolved question would force a different app registration/type interface.
Record consciously deferred work and why it cannot invalidate the first extraction.
Maintainer compatibility review is a design responsibility, not an excuse to stop
routine investigation or leave reviewable examples unfinished.

## 6. Delivery sequence and verification

| Change set | Work and dependencies | Required checks before commit |
|---|---|---|
| S09-plan | This plan and links from program/previous sprint | Repository references, scope, acceptance coverage and whitespace |
| S09.1a | Source/declaration/dependency register and initial measurement harness | Verify search coverage, harness fixture isolation, archive identities and reproducibility |
| S09.1b | Complete baseline measurements and affected-file checklist; depends on S09.1a | Retain all samples, manifests, service/runtime versions and a repeat run of representative measurements |
| S09.2a | Compare concrete interfaces and settle ownership/requirements; depends on S09.1 | Walk every fixture/error path; reconcile core/provider/app/tooling ownership and compatibility |
| S09.2b | Executable contract/type examples and selected design; depends on S09.2a | Positive/negative compile fixtures, runtime missing-capability/isolation checks, affected tests and generated parity if code changes |
| S09 handoff | Map selected contract to extraction/migration/packing tasks | No unowned coupling or unresolved registration/compatibility decision; update estimates and tracker |

Documentation changes use link/consistency checks. Executable changes additionally
run their relevant tests/types. If shared boot/types/generation change, run required
integration coverage with disposable services, package/test/reference types,
generated/reference parity and packed checks appropriate to the modified contract.
Preserve the existing supported CI matrix; distinguish local results from actual
workflow evidence and keep archive/source identities attached.

Do not start runtime extraction while the inventory still hides an incompatible
public type or consumer. Combine inseparable implementation/migration steps when
needed to keep each later commit in a passing state.

## 7. Handoff to S09.3–S09.10

This plan prioritizes inventory/design, but their outputs must make the remaining
sprint executable:

| Downstream task | Input required from S09.1–S09.2 | Completion evidence later |
|---|---|---|
| S09.3 — Metadata | Decision on real consumers and pure declaration support | Offline route/spec parity; explicit unsupported model metadata if deferred |
| S09.4 — Runtime extraction | Selected acquisition/access/cleanup contract and model/plugin rules | Live Mongoose behavior, registration/bootstrap failures and bounded partial cleanup |
| S09.5 — Core dependency removal | Import/declaration graph and core-only fixture | Packed core/minimal cannot resolve Mongoose and still import, typecheck, inspect and boot |
| S09.6 — Consumer migration | Complete reference/generated/new-module/CLI checklist | Existing auth/settings/worker behavior and parity pass with explicit provider selection |
| S09.7 — Compatibility | Export/config table and selected upgrade path | Retained prior-contract upgrade fixture and useful diagnostics |
| S09.8 — Artifact tooling | Chosen package inventory and dependency/peer ranges | All archive identities/ranges verified; full immutable-version preflight retained; isolated provider-free job |
| S09.9 — Failure/omission matrix | Per-phase scenarios and ownership sequence | Core-only, provider-present, missing-required, partial-failure and repeat-cleanup cases pass |
| S09.10 — Compare/close | Reproducible baseline harness and accepted contract | Before/after inventory/timing, migration docs, local/CI evidence and explicit remaining costs |

The post-extraction minimal fixture must not install the provider through spec,
CLI launcher dependencies, compatibility exports or test harness setup. Production
still has legitimate application-owned Mongoose and Redis needs. Redis request
limits remain required even if queue extraction happens later.

## 8. Risks and decision triggers

| Risk | How to expose it early | Response within scope |
|---|---|---|
| Type-only imports retain Mongoose | Inspect emitted declarations and compile an isolated core-only consumer | Move concrete types/accessors with the provider |
| Workspace resolution hides missing dependencies | Run installed fixtures outside the monorepo | Fix dependency/peer declarations and app-local resolution |
| Duplicate Mongoose instances break schema checks/plugins | Inspect physical copies and exercise real generated schemas | Set tested ranges/resolution policy; preserve concrete schema semantics |
| Provider discovery executes runtime code offline | Deny provider/runtime imports during inspection/sync | Separate static selection from runtime acquisition |
| Failed boot leaks a connecting resource | Pause acquisition and fail after ownership handoff | Register cleanup before awaiting readiness; reuse existing deadline/reporting |
| Extraction changes password, audit or soft-delete behavior | Retain Sprint 02 security tests and plugin/bootstrap fixtures | Fix migration parity; do not weaken application policy |
| A generic registry grows beyond demonstrated need | Compare both candidates against the same eight fixtures | Prefer the smaller models seam unless evidence supports generalization |
| New-module or CLI scripts select different providers | Generate and execute real consumer flows | Use one authoritative registration contract |
| Metrics reflect caching/network/service initialization | Separate installation/import/readiness and control fixture state | Retain raw samples and qualify comparisons |
| Added package breaks artifact/release assumptions | Inventory scripts and test publication planning without publishing | Generalize package inventory while preserving preflight/digest guarantees |

Initial backlog entries discovered while planning:

- [ ] **S09.1-doc:** reconcile the model-store comment promising typed model accessors
  with `sync`'s actual environment/config output. Treat accessor generation as a
  separate feature unless the selected design requires it.
- [ ] **S09.2-plugin:** explicitly test repeated-boot/global-plugin behavior and
  physical Mongoose instance identity before changing connection ownership.
- [ ] **S09.8-isolation:** separate the all-archive CLI fixture from provider-free
  installation proof; otherwise a successful minimal smoke can hide provider cost.

## 9. Effort, tracker and stopping conditions

Planning assumptions for one engineer familiar with this repository: S09.1 may
require roughly 1–2 engineering days; S09.2 roughly 1–2 days plus maintainer review
availability. These are provisional ranges, not delivery dates. The earlier
5–8-day estimate covered the whole first extraction; re-estimate S09.3–S09.10 after
measurements and the compatibility decision rather than adding that range blindly.
Registry access, supported CI availability and design findings can change elapsed
time. Independent measurements can share one local run; parallel agents are not
required by this plan.

| Item | Status | Evidence / remaining work |
|---|---|---|
| S09-plan | Complete | Source-grounded plan saved; 46 relative links/anchors across three documents, scope and whitespace validated; `reports/s09-plan-docs.log` |
| S09.1 | Complete | 2026-09-11: 41-row coupling register, behavior maps, harness `scripts/s09-inventory.mjs`, installation shapes A–D and startup baselines against `b42bd00`, reproduced at `9aba800` (inventory identical, timings within 4–11%) — [inventory](../design/mongoose-dependency-inventory.md); raw samples in ignored `reports/s09-inventory/{b42bd00,9aba800}/` |
| S09.2 | Complete | 2026-09-11: candidate A selected (augmentable `ModelsCapability`, `package.json` `tulipes.providers`, manifest `requires`), B and a boot option rejected; contract implemented in core (`boot/providers.ts`), built-in loader exposed as the first provider at `@tulipes/core/db`, generator/example declare it; 10 runtime + type fixtures, full suite with services, packed minimal/production smokes — [provider design §9.1](../design/mongoose-provider-design.md#91-what-ran-s092b-2026-09-11) |
| S09.3 | Complete | 2026-09-11: no consumer of model metadata exists; documented as unsupported in the spec README and offline-inspection guide, route schemas remain the only source |
| S09.4–S09.10 | Not started | Handoff criteria above; S09.4 moves `packages/core/src/db/*` into the provider package and changes the declared specifier; S09.5 removes the dependency and proves packed absence |

Stop inventory/design expansion once their exit criteria are met. Record unrelated
issues in the backlog, commit the coherent verified outputs and proceed to the
next authorized sprint item. Stop before extraction if a still-unresolved decision
would change the registration, ownership or compatibility contract; present the
concrete alternatives and evidence for that specific decision.

This planning change performs no new benchmarks, type-fixture execution or runtime
verification. It does not claim S09.1/S09.2 are implemented. Sprint 02's passing
checks remain the inherited baseline, not evidence that an unbuilt provider works.
