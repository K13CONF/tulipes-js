# Production readiness — detailed sprint task report

Prepared: 2026-09-11. Accepted Sprint 02 source: `37dbca7`.

**Latest completed operation:** the
[0.10.0-rc.1 candidate release](release-0.10.0-rc.1.md) — core `0.10.0-rc.1`,
spec `0.3.0-rc.4` and the first `@tulipes/mongoose` `0.1.0-rc.1` are published
under `next`; tag workflow, registry archive identity and fresh registry
installs of both presets passed. Sprint 03 (S09.1–S09.10) is complete and
merged (`21040d5`). Previously: [rc.3 candidate release](release-0.9.0-rc.3.md).

**Next planned workstream: Sprint 04, S10 (queues and Redis ownership), after the 0.10.0-rc.1 candidate ships.**
The [detailed execution plan](production-readiness-03.md) defines the coupling
register, measurement protocol, interface decisions, fixtures and delivery order.
Sprint 02 implementation, local closeout and CI acceptance are complete.
[CI run 34632402765](https://github.com/kemora13conf/bp-backend-express/actions/runs/34632402765) passed
all seven jobs, including Ubuntu Node 24.0.0/24.20.0, packed minimal on Linux/macOS,
production offline-only and full packed production. The
[evidence map](production-readiness-02-evidence.md) retains exact-source results,
archive digests and separate deployment/release gates. Provider extraction has
not started.

This report translates the existing program into executable tasks. Sprint 01 and
02 statuses come from their retained trackers and the local repository. Sprint 03
is the existing next workstream. Sprints 04–06 are a proposed division of the
previously unnamed later milestone, not additional implementation already started
or fixed delivery commitments. Package names and exact interfaces remain design
outputs. Closeout ran and retained GitHub CI for the authorized branch push; registry,
deployment and other external settings were not rechecked. Earlier release
statements remain dated evidence.

## 1. Program map and evidence baseline

| Sprint | Intended result | Current state | Main dependency |
|---|---|---|---|
| 01 — Package trust and first run | Reproducible minimal/production starters and verified release artifacts | Implementation recorded as delivered; external governance/release conditions remain distinct | Maintainer decisions for external account/release changes |
| 02 — Offline inspection and security | Deterministic offline specs and retained auth/settings abuse cases | Complete, including candidate CI acceptance | Deployment and release evidence remains separately scoped |
| 03 — First provider extraction | Core can install and boot without Mongoose | Planned | Sprint 02 closeout and a compatible capability boundary |
| 04 — Queues and sockets | Redis/queue and socket dependencies install only when selected | Proposed | Prove the first adapter before copying its design |
| 05 — Packaging and composition | Measured packaging decisions and supported feature combinations | Proposed; individual splits conditional | Provider contracts, installation measurements and migration costs |
| 06 — Production pilot and release readiness | Deployment, load, recovery and security evidence for a defined support promise | Proposed | Stable interfaces, a real pilot owner/environment and release gates |

Dependency order is **02 → 03 → 04 → 05 → 06** for implementation. Deployment
inventory and pilot acceptance planning may start earlier; pilot results must be
collected against the final candidate. A candidate release need not wait for all
later sprints if its scope is accurately described and its release gates pass.
A 1.0 readiness claim requires the broader milestone evidence.

Latest **local** 02-C3 closeout evidence, Node 24.14.0/macOS:

| Check | Result | What it establishes |
|---|---|---|
| Framework/spec suite | 225 passed, no skips, temporary MongoDB/Redis | Retained framework behavior, stream leases and early drain/resource cases |
| Reference production app | 55 passed, no skips | Real HTTP auth/settings behavior, including eight open-stream revocation cases and shutdown/fresh boot |
| Packed production app | 55 generated tests passed | Installed artifacts carry the same behavior outside workspace resolution |
| Types/builds/parity | Passed | Package, test and reference types; compiled archives; generated/reference modules, tests and configuration agree |
| Offline/runtime tooling | Passed in packed verification | Deterministic offline documents with connections denied; runtime spec generation works |
| Runtime lifecycle/PM2 | Passed in packed verification | Backend/worker checks and complete 202 response before isolated self-restart |
| Coverage | 82.01% statements; 68.7% branches; 86.74% functions; 84.14% lines | Existing boot/ACL/env floors passed; this is not whole-project security coverage |
| Dependency audits | Existing severity gates passed | Dated workspace/runtime and generated inventory; moderate maintenance notice retained |

Evidence is mapped by topic in the [closeout record](production-readiness-02-evidence.md).
Raw `reports/s08-closeout-*` files are ignored local artifacts. Separate CI evidence
for `37dbca7` now establishes the supported Linux/Node matrix and packed checks;
see the linked evidence map. Browser, replica-set failover, deployment and release
verification remain separate tasks.

## 2. Sprint 01 — Package trust and a verifiable first run

**Goal:** users can generate and run a minimal API without MongoDB/Redis, while
maintainers verify the exact packages selected for publication.

**Status:** do not rebuild the completed work below. Preserve it while resolving
remaining conditions and validating later release candidates. The original
[tracker](production-readiness-01.md) contains historical baseline problems; its
implementation status supersedes those problems where fixes already landed.

| Item | Already implemented | Remaining task or evidence |
|---|---|---|
| S01 — Identity and ownership | Licenses, metadata, ownership/contribution/security/support policies and Node engine range | Recheck metadata against the chosen release/source arrangement. Record restricted links honestly. Public anonymous source links/provenance remain conditional on a separate visibility decision. |
| S02 — Exact-artifact verification | Reusable CI, integration/coverage gates, isolated installs, digests and publication checks | Run the final candidate through the full matrix; retain archive digests and workflow links. Verify registry-side authentication configuration when preparing a release. |
| S03 — Starter presets | Default minimal, explicit production, parser validation and generated tests | Preserve both packed flows after each packaging change; record cold and cached first-run measurements on a documented runner. |
| S04 — Initial security controls | Production credential guard, auth regressions, error redaction and dependency fixes | Keep these regressions active; use Sprint 02 for expanded application-policy corrections and Sprint 06 for deployment evidence. |
| S05 — Onboarding and compatibility | Correct quick-start routes, migration, support and release recovery instructions | Re-execute tutorial commands against the final archive and reconcile versions, package ranges and supported lines during release preparation. |

### Remaining closeout tasks

- [ ] **01-C1 — Verify the supported matrix for the chosen candidate.** Retain
  Linux results for minimum/current supported Node 24, macOS minimal packed smoke,
  integration tests without skips, coverage, types, builds and audits. Record the
  source commit and artifact digests with the results. Owner: engineer/release owner.
- [ ] **01-C2 — Measure first run.** Use a fresh generated minimal app and record
  machine, runtime, cache state, registry conditions, install duration and time
  from completed prerequisites to the first successful `/health` and
  `/api/v1/hello` response. Keep the original two-minute aim as a measurement
  target; report actual results instead of inferring them from a warm local run.
- [ ] **01-C3 — Reconcile external prerequisites.** Confirm release owner/contact,
  package metadata and selected npm authentication method. If public visibility
  is not chosen, mark anonymous source access/provenance acceptance unmet or
  excluded explicitly. Do not change visibility as a side effect of this report.
- [ ] **01-C4 — Prepare the release change set when scheduled.** Update versions,
  changelog, generated ranges, compatible core/spec peer ranges and support table.
  Repack and verify the changed archives. Publish only through the separately
  authorized release workflow after review and required CI.

**Exit:** a reproducible clean install plus traceable tested archives, with each
external condition explicitly satisfied, deferred or excluded. Local success alone
does not complete public governance or publication acceptance.

## 3. Sprint 02 — Offline inspection and focused security review

**Goal:** the production starter describes routes/specs without services or
production secrets and retains tests for concrete auth/settings abuse cases.

### Completed work to retain

| Item | Delivered behavior | Regression obligation during future work |
|---|---|---|
| S06 | Shared native route declarations, deferred runtime handlers and explicit offline/runtime inspection | No runtime infrastructure/lifecycle acquisition offline; actionable legacy diagnostics; ACL/RAI and route/schema parity |
| S07 | Both presets and new-module output migrated; deterministic packed spec checks | Generated/reference parity, normalized runtime/offline documents and service-free minimal/offline jobs |
| S08a | Application-scoped PM2 target selection | Foreign/same-name processes unaffected; validate whole target list before action |
| S08b | Live session owner/expiry checks | Expired rows rejected before TTL cleanup; session owner bound to token subject |
| S08c | Credential versions and password-change race handling | Delayed login/change and cleanup cannot resurrect old credentials or overwrite newer credentials |
| S08d | Durable settings audit before privileged actions | Audit failure blocks action; values omitted; log filtering cannot suppress records |
| S08e | Explicit proxy trust and consistent client IPs | Forged forwarded chains do not bypass configured trust; audit/session IP agreement |
| S08f | Shared Redis request limits | Atomic replica-shared quotas, bounded failure, correct 429/503 behavior and cleanup |
| S08g | Bounded settings file access | Path/link/size rules, safe target replacement and no secret/key expansion leaks |
| S08h | Bounded log history and streaming | File/line/read/output/connection/lifetime limits, rotation behavior and backpressure cleanup |
| S08i | HTTP restart acceptance before execution | Complete response handoff before PM2 execution; cancellation, scope revalidation and bounded callbacks |
| S08j | Browser bearer/cookie adaptation guidance | Existing transport rejects cookie/URL credentials; CORS does not imply cookie auth or CSRF protection |
| S08k | Strict refresh reuse expires the device family | Concurrent duplicate winner also becomes unusable; unrelated devices survive; uncertain writes return sanitized failure |
| S08l | Current authority checked throughout open SSE streams | Role/user/session/credential/token changes close streams under the lease bound; failures do not leak details or accumulate pending checks |
| S08m | Early drain notifications and per-boot stream shutdown | Healthy SSE ends without HTTP drain timeout; pending/late openings stop; regular requests/jobs retain resources; later boots have fresh admission |

S08l is committed as `2d23433`. Its default authorization lease lasts at most two
seconds from a check's start with a responsive event loop; the separate socket
flush bound and already-buffered data are documented limits.

### S08m — Graceful log-stream shutdown before HTTP drain

**Status:** implemented and locally verified on 2026-09-11; see the active tracker.
**Owner:** engineer, with maintainer review of the public
lifecycle contract. **Suggested effort:** 1–3 engineering days, then re-estimate
if lifecycle compatibility requires a larger design change. These are planning
assumptions, not elapsed-time commitments.

- [x] **S08m.1 — Retain the failing lifecycle scenario.** Open a real idle SSE
  stream and call application shutdown. Demonstrate the existing forced HTTP drain
  timeout. Add an active stream and an opening request paused in authorization.
  The tests should distinguish normal graceful completion from forced cleanup.
- [x] **S08m.2 — Define the early shutdown signal.** Choose the smallest public
  lifecycle capability that tells long-lived handlers shutdown has begun before
  waiting for HTTP connections. Specify availability by boot phase, late
  subscribers, repeated shutdown and startup failure. Preserve database/producer
  availability for work still draining. Document the contract and compatibility.
- [x] **S08m.3 — Integrate cleanup ownership.** Trigger the signal once, before
  HTTP drain. Preserve aggregate diagnostics, the overall deadline, idempotent
  shutdown and attempts to clean every acquired resource even if another fails.
  Avoid an unbounded new hook or a second independently owned cleanup sequence.
- [x] **S08m.4 — Connect settings streams.** Stop admitting new streams on the
  signal; end existing responses, close tails and clear timers. Abort cooperative
  authorization work. Cover a callback completing after shutdown so it cannot
  reopen SSE or resume output. Do not wait indefinitely for an ignored abort.
- [x] **S08m.5 — Protect normal draining.** Verify ordinary in-flight requests and
  queue work retain required resources; an early stream signal must not close
  shared models/Redis before their consumers finish. Exercise repeated shutdown,
  cleanup exceptions and a stuck authorization callback.
- [x] **S08m.6 — Update consumers and documentation.** Mirror reference and
  generated starter wiring, check phase-specific types, update migration and
  security guidance, and keep offline inspection free of lifecycle execution.
- [x] **S08m.7 — Validate and commit.** Run relevant lifecycle/stream regressions,
  full required integration coverage, test/package/reference types, builds,
  generated parity and packed production startup/shutdown/worker/PM2 checks.
  Record evidence in the tracker and commit under `sprint-02/S08m`.

**Acceptance:** an otherwise healthy open log stream ends when shutdown begins
and does not cause the HTTP drain timeout. Pending checks cannot resume output;
normal requests/jobs drain with their dependencies available; repeated or failed
cleanup remains bounded and correctly reported. CI must establish the supported
platform/runtime results separately from local runs.

### S08 closeout — Documentation and evidence reconciliation

Local closeout and final CI acceptance completed on 2026-09-11; see the
[evidence map](production-readiness-02-evidence.md) and final tracker entry.
All 02-C1–C5 criteria are complete. Deployment follow-ups have accountable roles,
with actual pilot personnel still to be selected under S15.1.

- [x] **02-C1 — Reconcile current behavior.** Update cumulative changelog and
  security/migration summaries to cover S08a–S08m. Mark older incremental statements
  as historical where later fixes supersede them, including restart delivery,
  audit durability, rate limits and stream authorization/draining. Remove ambiguity
  without rewriting the retained validation history.
- [x] **02-C2 — Map each review topic to evidence.** Link its implementation,
  retained test, local result and CI result. Distinguish implemented controls,
  documented application policy, conditional browser-cookie work and unverified
  deployment properties. Do not use test counts as a substitute for this mapping.
- [x] **02-C3 — Verify the complete candidate.** Run both packed presets and the
  production offline-only job; preserve coverage floors, audits and guide/module
  parity. Attach Linux/Node matrix results through the existing workflow.
- [x] **02-C4 — Carry deployment gaps forward.** Assign the named tasks in Sprint
  06 for nginx topology, replica-set failures, audit retention/archival, incident
  alerts and cross-replica/load tuning. Keep cookie adaptation conditional.
- [x] **02-C5 — Close the tracker accurately.** Mark Sprint 02 complete only after
  S08m and closeout acceptance pass, with outstanding external evidence explicitly
  identified. Commit the documentation closeout separately from lifecycle code.

**Out of scope:** provider extraction, automatic cookie authentication, publication
and new administrative product features. S08m completion is not permission to
silently start those changes.

## 4. Sprint 03 — Extract the first infrastructure provider

**Goal:** prove a small, compatible provider boundary using Mongoose. A minimal
core installation must not acquire Mongoose through direct dependencies, runtime
imports or emitted public type declarations.

**Status:** S09.1–S09.10 complete on 2026-09-11 on branch
`feat/sprint-03-s09-inventory` — inventory, harness, baseline and the
before/after comparison in the [dependency inventory](../design/mongoose-dependency-inventory.md);
seam, extraction into `@tulipes/mongoose`, upgrade fixture and failure matrix
in the [provider design](../design/mongoose-provider-design.md). Supported CI
evidence on the merged source and the release decision (three-package
candidate, ranges, dist-tags) remain with the maintainer. See the
[Sprint 03 execution plan](production-readiness-03.md). **Owner:** engineer; maintainer
owns compatibility/versioning decisions. **Dependencies:** Sprint 02 lifecycle behavior
and offline declarations. The original estimate was 5–8 engineering days for the
first extraction; reassess after the inventory and interface task below.

### S09 — Mongoose provider and capability contract

- [x] **S09.1 — Inventory every coupling.** Map core dependencies, root/subpath
  exports, boot acquisition, context types, model registration, module config,
  scaffold output, CLI sync, spec metadata and tests that reference Mongoose.
  Record package sizes, installed dependency inventory and startup measurements
  before changing them. Deliver a bounded extraction checklist with affected files.
- [x] **S09.2 — Define the capability seam.** Specify how an app opts into the
  provider, how modules declare/require models, when models become available and
  which component owns acquisition/cleanup. Reuse the boot driver and BootReport.
  Keep concrete infrastructure types out of core's public context. Include valid
  database-free, provider-present and missing-required-provider examples with
  compile-time fixtures; avoid creating a general plugin bus without demonstrated
  requirements.
- [x] **S09.3 — Separate metadata from connected models.** Identify whether model
  documentation is actually needed for current tooling. Where required, expose
  declaration metadata without building connected models or importing runtime
  plugins offline. Preserve the route-schema declaration source. If metadata
  extraction is deferred, make the unsupported capability explicit instead of
  substituting dummy models or connecting the database.
- [x] **S09.4 — Move runtime implementation.** Create the provider package with
  registration, model store, connection policy, exports, dependencies and tests.
  Register cleanup immediately after acquisition, including partially failed boot.
  Preserve useful error aggregation and ordering; do not hide provider failures
  behind a generic startup error. Keep provider-specific tuning in the provider.
- [x] **S09.5 — Remove core's installation coupling.** Remove direct/transitive
  Mongoose dependencies and runtime/type imports from the core-only path. Inspect
  emitted declarations and root/subpath imports from an isolated packed install.
  Do not describe runtime-disabled Mongoose as an installation reduction.
- [x] **S09.6 — Migrate real consumers.** Update the production reference app,
  starter generator, model examples, module helpers, CLI-generated types and spec
  consumers. Minimal must omit the provider completely. Document manual migration
  for apps whose generated files were edited locally.
- [x] **S09.7 — Define legacy compatibility.** Inventory documented database
  exports and existing app usage. Choose a bridge, deprecation window or explicit
  breaking prerelease path. Any compatibility wrapper that installs Mongoose must
  live outside the claimed provider-free core path. Retain an upgrade fixture
  from the prior supported app contract and record expected diagnostics.
- [x] **S09.8 — Extend artifact verification.** Generalize the currently two-package
  artifact manifest/validation/publish planning for the chosen package inventory.
  Verify license, exports, dependency/peer ranges and digest handling for every
  archive; preserve preflight of all immutable-version conflicts before uploads.
  Add isolated core-only and provider-enabled installation jobs.
- [x] **S09.9 — Verify failure and omitted-provider modes.** Retain live database
  model/HTTP behavior, duplicate registration and startup failures, partial cleanup,
  shutdown deadlines and declaration parity. Prove core-only boot/inspection works
  when importing or resolving Mongoose is impossible. Missing required capability
  should produce an actionable module error.
- [x] **S09.10 — Record measurements and commit migration.** Compare installed
  inventory/size and documented startup measurements with S09.1. Update migration,
  package docs and the sprint tracker with exact local/CI evidence. Break delivery
  into reviewed, coherent commits; keep package release as a separate decision.

**Acceptance:** a packed minimal app installs and boots without Mongoose; an
explicitly configured production app keeps database behavior; no provider type
leaks through core's public declarations; boot reports, failure cleanup, offline
inspection and upgrade fixtures pass. The compatibility cost and measured
installation reduction are recorded before deciding the next adapters.

**Suggested commit sequence:** contract plus tests → runtime extraction and
consumer migration → packed/upgrade verification and documentation. Each commit
must represent a passing coherent state; combine inseparable migrations when needed.

## 5. Sprint 04 — Make queues and sockets independently optional

**Goal:** selecting no queues or sockets must remove their installation costs and
runtime acquisition, while production backend/worker behavior remains reliable.

**Status:** proposed allocation of the existing later adapter work. **Owner:**
engineer. **Dependency:** S09 proves the capability/lifecycle pattern. Estimate
queues and sockets separately after S09; do not assume both fit in one fixed sprint.
If necessary, deliver queues first and schedule sockets as the next increment.

### S10 — Queue and Redis ownership

- [ ] **S10.1 — Map Redis consumers.** Separate queue manager/worker connections,
  producer connections, application caching and the security rate limiter. The
  production app can still need Redis without selecting queues. Record ownership,
  namespaces, timeout policies and shutdown order for each consumer.
- [ ] **S10.2 — Design queue capabilities by mode.** Specify producer access,
  backend registration and worker consumption, absent-queue behavior and checked
  required-queue access. Preserve type narrowing and useful errors for modules
  needing an unavailable queue provider.
- [ ] **S10.3 — Extract queues.** Move BullMQ and queue-owned Redis dependencies
  behind explicit provider selection. Keep connection ownership unambiguous;
  closing a worker must not close an unrelated rate-limit/cache connection.
- [ ] **S10.4 — Retain runtime and failure cases.** Test real enqueue/consume,
  registration errors, reconnect failures, worker drain, failed startup, repeated
  shutdown and cleanup with active work. Test one connection owner's failure
  without silently disabling an unrelated Redis consumer.
- [ ] **S10.5 — Migrate and measure.** Update worker entrypoints, queue examples,
  generated dependencies/types and migration docs. Verify production's actual
  worker through packed artifacts; prove a queue-free core install contains no
  BullMQ or queue-owned ioredis. Report the remaining app-owned Redis dependency.

### S11 — Socket provider

- [ ] **S11.1 — Define attachment and availability.** Specify when the socket
  provider can attach to the HTTP server, the capability visible to modules and
  behavior in worker/inspection modes. Define authorization and application
  callback ownership without replacing existing application policy.
- [ ] **S11.2 — Extract implementation and types.** Move Socket.IO-specific
  runtime/types/dependencies behind explicit selection. Preserve the shared HTTP
  server's ownership; provider cleanup must not independently destroy it too early.
- [ ] **S11.3 — Retain live socket behavior.** Exercise connection, event handling,
  configured authorization, connection failure and shutdown with active clients.
  Test failed partial setup and repeated cleanup; compare existing public examples.
- [ ] **S11.4 — Migrate generation and verify absence.** Update starter features,
  socket examples, generated types and upgrade notes. Prove a socket-free packed
  app cannot resolve Socket.IO and still boots, serves HTTP and generates specs.

### Sprint acceptance and matrix

- [ ] **04-C1 — Run targeted combinations.** At minimum: core only; models only;
  queues with a worker; sockets with HTTP; production with all selected providers;
  and rate limiting without queues. Select combinations for real ownership risks,
  rather than promising every theoretical feature permutation.
- [ ] **04-C2 — Verify offline paths for each selection.** Services and runtime
  secrets remain unnecessary for declarations/spec generation. Provider imports
  must not run application lifecycle hooks during inspection.
- [ ] **04-C3 — Retain installed-artifact and migration evidence.** Test exact
  archives, public type contracts, generated/reference parity, audits and supported
  CI targets. Record which packages/dependencies disappeared in each mode.

**Acceptance:** each provider installs only when chosen; combined apps still own
and release resources correctly; backend/worker/socket and omitted-provider
modes have independent retained evidence. Migration does not weaken existing
security controls or turn application Redis needs into hidden core dependencies.

## 6. Sprint 05 — Packaging decisions and feature composition

**Goal:** turn measured provider improvements into a comprehensible installation
and scaffolding experience. A package split is useful only when it reduces cost
or clarifies ownership enough to justify its migration and release burden.

**Status:** proposed, with conditional implementation. **Owners:** engineer and
maintainer for API/support decisions. **Dependency:** completed provider extraction
measurements. Set effort only after the go/no-go decisions below.

### S12 — Decide whether to separate CLI/tooling

- [ ] **S12.1 — Measure remaining runtime cost.** Attribute installed packages and
  startup imports to the HTTP runtime, scaffold templates, TypeScript execution,
  development tools and spec tooling. Compare an app running compiled JavaScript
  with one using the current development/start scripts.
- [ ] **S12.2 — Record the decision and command contract.** Decide whether the CLI
  remains in core or gets a separate package. Specify installation, executable
  lookup, core/spec compatibility, template location and update behavior. Keep a
  migration path for documented `tulipes` commands.
- [ ] **S12.3 — Implement only the selected path.** If separated, move executable,
  templates and tooling dependencies, update ranges/exports and archive checks.
  If retained, document measured reasons and any smaller dependency improvements;
  do not create an empty package just to satisfy a proposed package list.
- [ ] **S12.4 — Verify user journeys.** Run install → init → sync → check → types
  → tests → start → specs from fresh packed artifacts. Test both presets, module
  generation and upgrade behavior without workspace symlinks.

### S13 — Decide the translation contract

- [ ] **S13.1 — Inventory translation usage.** Identify core error formatting,
  response helpers, module locale loading, always-available `ctx.t`, and concrete
  i18next types exposed publicly. Record what a locale-free minimal app needs.
- [ ] **S13.2 — Choose a stable core guarantee.** Decide whether the translator
  stays always available, has a lightweight fallback, or requires a provider.
  Define missing-key/fallback/error behavior and ensure error handling cannot fail
  because translation is absent.
- [ ] **S13.3 — Implement and migrate if justified.** Extract i18next dependencies
  only if the selected design preserves a useful contract. Update declarations,
  generated examples, settings translation editing and migration guidance.
- [ ] **S13.4 — Retain behavior.** Verify translated/default error envelopes,
  missing locales, module overrides, no-provider behavior and offline tooling;
  inspect emitted core declarations for concrete provider leakage.

### S14 — Compose supported starter features

- [ ] **S14.1 — Define supported combinations and prerequisites.** Preserve
  minimal and production as named presets. Write down requirements such as auth
  needing models, settings needing auth/core, workers needing queues and sockets
  needing HTTP. Decide whether additional flags are worth supporting now.
- [ ] **S14.2 — Reject invalid input before writing files.** Extend CLI parsing
  and feature validation only for selected combinations. Cover unknown/missing/
  conflicting flags, unavailable dependencies and non-empty target directories.
- [ ] **S14.3 — Generate the complete dependency graph.** Emit only selected
  modules, package dependencies, environment declarations, capabilities, scripts
  and operational examples. Update generated tests and offline route declarations
  together; do not generate imports of absent features.
- [ ] **S14.4 — Decide auth/settings ownership.** Keep these as editable generated
  application code by default. A library proposal must separately justify how
  applications customize credential, role, audit, file and restart policies and
  receive security updates without losing local changes. Deferring this split is
  a valid recorded outcome.
- [ ] **S14.5 — Make compatibility executable.** Maintain a bounded combination
  matrix, packed install tests and upgrade examples. Document which combinations
  are supported, what infrastructure they need and the tested package ranges.

**Acceptance:** users understand what they install and configure; dependency
reduction is measured; existing command and application migrations are explicit;
unsupported combinations fail before file creation. Optional CLI/i18n/auth/settings
splits have a reasoned decision, not an assumed implementation commitment.

## 7. Sprint 06 — Production pilot, operational evidence and release

**Goal:** validate a named deployment against agreed workload, recovery and
security criteria, then prepare an accurately scoped release/support decision.

**Status:** proposed. **Owners:** pilot/operator owner, engineer and release
maintainer; assign actual people before execution. **Dependencies:** a chosen
candidate with stable interfaces and an isolated staging environment. Deployment
and publication remain separately authorized operations.

### S15 — Deployment and recovery

- [ ] **S15.1 — Define the pilot acceptance sheet.** Name the app, owner, topology,
  workload, supported runtime/services, latency/error targets, resource budgets,
  recovery time and acceptable data loss. Use agreed numbers before load testing;
  do not invent a universal framework throughput target.
- [ ] **S15.2 — Verify real ingress.** Run the actual nginx/TLS configuration for
  the chosen hops. Test forwarded IP/host/protocol behavior, forged headers,
  backend-port isolation, request limits and SSE proxy buffering/timeouts. The
  existing Express/header tests do not establish deployed proxy correctness.
- [ ] **S15.3 — Exercise service failure.** Use a disposable MongoDB replica set
  to test primary loss and uncertain refresh/audit acknowledgments before/after
  commit. Test Redis outage/recovery and limiter failure behavior across replicas.
  Record observed outcomes without claiming rollback from a missing acknowledgment.
- [ ] **S15.4 — Exercise application lifecycle.** Run rolling restart/deployment
  with active requests, jobs, sockets and log streams. Verify readiness, drain
  order, PM2 target isolation, complete restart acceptance and bounded failures.
  Record the remaining cross-process inventory-check/command race and partial
  restart outcomes; decide whether the pilot needs stronger coordination.
- [ ] **S15.5 — Rehearse backup and rollback.** Restore representative data and
  configuration in isolation, verify session/credential migration compatibility,
  measure recovery objectives and rehearse returning to the previous supported
  version. Preserve required audit records. Write an operator runbook from actual
  results, including irreversible schema or credential-transition limits.

### S16 — Security operations and load evidence

- [ ] **S16.1 — Review deployment privileges and secret handling.** Check database
  roles, service networking, filesystem ancestors/permissions, log access, PM2
  daemon access, environment files and secret rotation for the pilot. Retain
  sensitive values outside reports and use scoped fixtures for testing.
- [ ] **S16.2 — Define audit retention and archival.** Name the owner, retention
  period, archive destination, access control and storage alerts. Test archive/
  restore and sink-failure behavior. Request records must remain distinguishable
  from action completion; add outcome correlation only as a separately scoped
  requirement if the pilot needs it.
- [ ] **S16.3 — Define incident signals.** Select useful sanitized events for
  refresh reuse, repeated credential failures, audit unavailability, exhausted
  stream capacity and uncertain refresh/restart outcomes. Avoid token/password
  logging. Test signal delivery, alert thresholds and a response runbook with the
  operator; do not promise theft detection without token reuse.
- [ ] **S16.4 — Test browser flows in a browser.** For current bearer transport,
  validate real preflight/origin behavior, credential handling, refresh
  coordination and reconnect logic. If cookie auth is explicitly adopted, add
  cookie/CSRF implementation and tests for Secure/HttpOnly/SameSite/domain/path,
  login/refresh/logout, exact origins and cross-site requests before accepting it.
- [ ] **S16.5 — Measure limits under realistic concurrency.** Exercise auth,
  settings, queues, sockets and slow SSE readers with multiple backend replicas.
  Record latency percentiles, errors, event-loop delay, memory/file descriptors,
  database query load and Redis usage. Verify that stream rechecks stay bounded
  and output stops at lease expiry under the supported operating conditions.
- [ ] **S16.6 — Decide replica-wide controls from evidence.** Local SSE caps do not
  create a global cap; shared fixed-window request quotas do not by themselves
  bound total work. Decide whether global stream leases, different rate policies
  or restart coordination are required. If so, specify crash recovery/lease expiry,
  races and failure policy before implementing and retesting them.
- [ ] **S16.7 — Complete an independent review.** Have someone other than the
  implementing author assess privileged operations, threat coverage, migrations
  and dependency findings. Track actionable findings with severity, owner and
  closure evidence. Neither this report nor retained tests constitute an external
  audit or certification.

### S17 — Support and release readiness

- [ ] **S17.1 — Resolve pilot findings.** Fix blockers in coherent changes with
  regressions and rerun affected operational tests. Maintain an explicit list of
  accepted limitations and operator responsibilities tied to the chosen topology.
- [ ] **S17.2 — Finalize the support promise.** Update maintained package lines,
  runtime/platform scope, deprecations, upgrade path, security contacts and
  backport expectations to match actual capacity and evidence. Do not silently
  add Windows or another Node major to the tested support claim.
- [ ] **S17.3 — Prepare the candidate archives.** Choose versions/ranges, update
  changelog/migration/tutorial docs and package metadata, then run all required
  CI, coverage, inventories, packed install and compatibility gates. Retain source
  commit, digests and links to pilot results for those exact artifacts.
- [ ] **S17.4 — Resolve external release conditions.** Verify the selected registry
  authentication and source/provenance arrangement with the maintainer. Keep
  account setup, repository visibility and publication decisions explicit; verify
  current provider requirements when executing those tasks.
- [ ] **S17.5 — Execute an authorized release and verify it.** Publish the tested
  archives through the gated workflow under the selected prerelease/stable tag;
  verify clean installation from the registry and record versions/digests. On
  partial publication, follow the documented immutable-version recovery path.
  A stable version change requires testing its new archive bytes.
- [ ] **S17.6 — Complete the milestone report.** Record passed criteria, owners,
  CI/pilot evidence, migration/rollback instructions and remaining limitations.
  Decide whether the result supports another prerelease, a stable 0.x release or
  the broader 1.0 promise. The decision follows evidence rather than sprint count.

**Acceptance:** the named pilot meets agreed targets, restore/restart/failure
behavior is demonstrated, critical findings are resolved, and the release/support
claims match the archived evidence. Publication itself does not prove readiness.

## 8. Delivery discipline and immediate sequence

For each future change set, use the owning sprint/task ID, define the behavior
and acceptance criteria before editing, retain meaningful regressions, update
reference/generated consumers together, run required checks, update the tracker
and commit the coherent result before starting the next change set. Preserve
unrelated work. Push, merge, deploy, publish and visibility changes require their
own existing or subsequent authorization.

Recommended immediate order:

1. **Completed:** S08m lifecycle implementation and S08-readability. All tracked
   tests/helpers and both starter test outputs now have expanded formatting and
   space between distinct steps, with test behavior and fixture values retained.
2. **Completed — 02-C1–C5:** local documentation, evidence mapping, deployment
   backlog assignment and final CI acceptance are recorded for `37dbca7`.
3. **S09.1–S09.2:** follow the [detailed plan](production-readiness-03.md) to measure
   current dependencies and settle the first provider seam; use those results to
   confirm extraction scope and estimate.
4. **S09.3–S09.10:** extract Mongoose and prove installed absence, compatibility,
   cleanup and production behavior before applying the pattern elsewhere.
5. Re-estimate Sprints 04–06 from the first extraction and the pilot's concrete
   requirements. Complete selected tasks in order; record deferrals explicitly.

No schedule dates are assigned. The original one-engineer capacity assumption
still needs maintainer review, and infrastructure/account/review availability can
change elapsed delivery time. Only S08m's provisional range and Sprint 03's original
range are quoted here; later sprint durations need evidence before commitment.

## 9. Source documents

- [Sprint 01 plan and implementation status](production-readiness-01.md)
- [Sprint 02 tracker and S08 history](production-readiness-02.md)
- [Sprint 03 inventory and provider design plan](production-readiness-03.md)
- [Offline inspection contract](../offline-inspection.md)
- [Security model and remaining review](../security-model.md)
- [Testing and packed verification](../testing.md)
- [Core migration guide](../../packages/core/MIGRATING.md)
- [Support and compatibility policy](../support.md)
- [Release and recovery workflow](../releasing.md)
- [Reusable CI verification](../../.github/workflows/verify.yml)
- [Artifact preparation/verification](../../scripts/artifacts.mjs)

These repository documents are the basis for task status and proposed sequencing.
Older milestone prose is historical where the later sprint tracker records a
completed correction. Recheck external requirements when executing the relevant
release or deployment task.
