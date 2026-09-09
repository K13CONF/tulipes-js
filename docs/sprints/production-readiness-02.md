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
| S08 — Focused auth/settings security review | Pending | Password-change and revocation timing, audit sink failure/filtering, proxy/IP policy and rate limits, file/log paths, streaming bounds, PM2 target scope, cookie/CSRF guidance |

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
