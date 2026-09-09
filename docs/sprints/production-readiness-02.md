# Sprint 02 — Offline inspection and security review

Status: in progress, continued on 2026-09-09 from merged Sprint 01 and the rc.2
security fix. This working increment implements offline native-router inspection and migrates
both starters. It does not publish a version or change repository visibility.

## Goal and backlog

A production starter can generate deterministic route/spec descriptions without
services or production secrets, with runtime parity proven by retained tests.
The subsequent auth/settings review retains abuse cases and records remaining
application-policy decisions.

| Item | Status | Exit evidence |
|---|---|---|
| S06 — Shared route declarations and explicit offline tooling | Implemented | Native `routes/*.routes.ts` factories wrapped in `defineRoutes` are consumed by runtime and `inspectRoutes`; `--offline` and `--runtime` CLI paths; strict legacy diagnostics; shared RAI scan; dynamic authorization metadata |
| S07 — Starter migration and repeatable verification | Implemented and locally verified | Both presets and new-module output use native routers; controllers acquired once through `runtime()`; production prefix shared in `config/routes.ts`; generated runtime parity tests; packed offline CI without services |
| S08 — Focused auth/settings security review | In progress: S08a locally verified | Password-change and revocation timing, audit sink failure/filtering, proxy/IP policy and rate limits, file/log paths, streaming bounds, PM2 target scope, cookie/CSRF guidance |

## Design and compatibility

See [offline inspection](../offline-inspection.md) for the interface, migration
steps and guarantees. Runtime route factories remain supported. Offline behavior
is explicit, while generated `yarn spec` scripts select it. The initial interface
uses static route selection; runtime environment-dependent factories use
`--runtime`. Runtime boot still validates all environment values and credentials.

Offline inspection validates the module graph, environment declaration structure
and ownership, ACL and route declarations. It skips runtime config, controllers,
models, middleware acquisition, translation initialization, infrastructure and all
application lifecycle hooks. Declaration imports are trusted JavaScript, not a
sandbox. Model metadata extraction and provider packaging remain later work.

## Validation

- Core regressions verify forbidden runtime imports and service connections,
  absent secrets, malformed declarations and graphs, legacy errors, authorization,
  runtime route/schema parity and repeatable production document generation.
- Both starter suites compare normalized OpenAPI/Postman documents from runtime
  and offline router builds; shared schema instances need not have object identity.
- Packed verification runs offline route listing and spec generation with sockets
  denied, invalid service URLs and empty runtime secrets. Two separate generator
  processes must produce byte-identical documents.
- A dedicated CI job checks the packed production preset without services.
- Local verification on Node 24.14.0/macOS: all 116 framework/spec tests passed
  with temporary MongoDB and Redis, no skips; all four production reference app
  tests passed. The 30 inspection regressions are included in the 116, covering native router
  middleware, param callbacks, nested/parameterized mounts and error middleware.
- Coverage passed unchanged floors: 81.89% statements, 68.7% branches, 86.41%
  functions, 84.06% lines. Package and example typechecks, test type contracts,
  production builds and scaffold/agent-guide parity passed.
- Corrected native-router packed verification passed: minimal startup/shutdown,
  production backend and worker, generated app tests, runtime/offline document
  parity, and isolated PM2 supervision/restart. The production offline-only smoke
  passed with network connections denied. Generated dependency audits passed the
  existing severity gates. Both starter suites passed all four tests.
- Local evidence is in ignored reports/native-router-packed.log,
  reports/native-router-integration.log, reports/native-router-artifacts.log and
  reports/scaffold-*/. CI on Linux and the supported Node matrix remains the release
  gate; this local run does not establish those platform results.

S08 must be completed before declaring the whole sprint finished. Provider
extraction remains Sprint 03; no new package split is included here.

## Working discipline

Before each change set, read this tracker and the relevant sprint acceptance
criteria, and identify the owning item. Update its status with actual validation
results. Commit each coherent, verified set before starting the next. Keep S08
changes separate from S06–S07; provider extraction remains outside Sprint 02.

## S08 change sets

S06–S07 and the sprint/commit workflow were committed as `c0befdb`.

### S08a — PM2 target scope

The restart helper selected the entire PM2 inventory for an empty target list,
and restarting by name could affect a different application with the same name.
The correction derives the app root from the installed helper, matches canonical
PM2 working directories exactly, validates all requested names before any restart,
and restarts only verified numeric IDs. A failed connection also disconnects.
Self is restarted last; delivering the HTTP response before self-restart remains
an explicit follow-up rather than an implied guarantee of ordering.

Locally verified on Node 24.14.0/macOS:

- All 11 helper regressions passed after a red run with 10 failures. Cases cover
  whole-request validation, foreign and duplicate names, cluster members, invalid
  scope metadata, numeric IDs, self ordering and connection cleanup.
- All 127 framework/spec tests and four production reference app tests passed
  with temporary MongoDB and Redis and no skips. Coverage floors passed unchanged.
- Package, example and test typechecks, builds and generated/reference parity
  passed.
- Packed production installation, generated tests/types, runtime/offline specs,
  backend/shutdown and worker checks passed. The real PM2 daemon check verified
  that both owned processes restarted while two unrelated processes retained their
  PIDs, including one sharing the backend's name. Invalid target sets were rejected.
- Evidence: ignored `reports/s08-pm2-{red,tests,integration,parity,artifacts,packed}.log`
  and `reports/scaffold-production/`. Linux and Node matrix CI remain release gates.

Remaining S08 work: password-change/revocation timing, audit durability and filtering,
proxy/IP/rate-limit policy, log/file constraints and streaming bounds, restart
response delivery, and cookie/CSRF guidance. None is marked complete by this fix.
