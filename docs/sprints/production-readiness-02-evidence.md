# Sprint 02 — Security review evidence and external gates

Reviewed locally on 2026-09-11, Node 24.14.0/macOS. Runtime/test source baseline:
`1be808c58d2f0155a785796d3c7964f96a5f70ae` (S08m plus test readability).
The closeout changes documentation only. Package archives include the updated
changelog/migration text; their manifest identifies the baseline HEAD, not a clean
release commit. They are local verification artifacts, not release candidates for
publication. Final release bytes require their own committed-source verification.

## Review topics and retained evidence

Each row maps a control to executable evidence. **Local** means the full closeout
run described below, including the generated production suite where applicable.
**CI pending** means no run for this source commit was returned by the read-only
GitHub query on 2026-09-11. Workflow definitions describe future checks, not results.
Historical red/green evidence remains in the linked Sprint 02 change-set history.

| Topic | Implementation / policy | Retained test and scenario | Local / CI |
|---|---|---|---|
| S06 — Offline declarations | [Inspection](../../packages/core/src/boot/inspect.ts), [contract](../offline-inspection.md) | [Inspection tests](../../packages/core/tests/inspection.test.ts): forbidden runtime imports/services, malformed declarations and route/schema parity | Passed / pending `tests`, `offline` |
| S07 — Starter parity | [Generator](../../packages/core/src/cli/init.ts), [packed smoke](../../scripts/scaffold-smoke.mjs) | [Presets](../../packages/core/tests/presets.test.ts), [app parity](../../example/tests/app.test.ts): runtime/offline documents; two isolated generators produce identical bytes with connections denied | Passed / pending `pack`, `minimal`, `offline`, `production` |
| S08a — Restart scope | [PM2 helper](../../example/modules/settings/helpers/pm2.ts) | [Scope tests](../../packages/core/tests/pm2-scope.test.ts): whole-target validation, foreign/same-name processes, numeric IDs and cleanup; [real PM2 smoke](../../scripts/pm2-smoke.mjs) retains unrelated PIDs | Passed / pending `tests`, `production` |
| S08b — Session validity | [Auth helper](../../example/modules/auth/helpers/auth.ts) | [App tests](../../example/tests/app.test.ts): exact expiry before TTL cleanup, reassigned owner, same-second password change, refresh versus device revocation | Passed / pending `production` |
| S08c — Credential races | [Auth helper](../../example/modules/auth/helpers/auth.ts), [password helper](../../example/modules/auth/helpers/passwords.ts) | [App tests](../../example/tests/app.test.ts): paused login/password change, stale overwrite, delayed/failed cleanup, failed credential write and legacy upgrade races | Passed / pending `production` |
| S08d — Audit barrier and ACL | [Audit helper](../../example/modules/settings/helpers/audit.ts), [model](../../example/modules/settings/models/audit-event.model.ts) | [App tests](../../example/tests/app.test.ts): fatal-only logging, all sink-failure action paths, delayed acknowledgment, value omission and ordinary-admin denial | Passed / pending `production` |
| S08e — Proxy/IP policy | [Proxy helper](../../example/modules/security/helpers/proxy.ts), [nginx templates](../../example/nginx) | [Proxy tests](../../packages/core/tests/proxy-trust.test.ts): forged chains, untrusted sockets, multi-hop and IPv6; app test checks session/audit IP agreement | Passed / pending `tests`, `pack`, `production`; live ingress remains S15.2 |
| S08f — Shared request limits | [Limiter](../../example/modules/security/helpers/rate-limit.ts), [security routes](../../example/modules/security/routes/security.routes.ts) | [Rate tests](../../packages/core/tests/rate-limit.test.ts): atomic shared quotas, identity/namespace isolation, expiry, failed/stalled Redis; app tests verify rejection before parsing/authentication | Passed / pending `tests`, `production`; deployment load remains S16.5–S16.6 |
| S08g — Settings paths and file bounds | [Files](../../example/modules/settings/helpers/files.ts), [env editing](../../example/modules/settings/helpers/env-file.ts) | [File tests](../../packages/core/tests/settings-files.test.ts): links/special files, descriptor growth, failed replacement, dotenv round-trip and key expansion; app tests cover translation/env endpoints | Passed / pending `tests`, `production` |
| S08h — Log bounds and resource ownership | [Tail](../../example/modules/settings/helpers/log-tail.ts), [streams](../../example/modules/settings/helpers/log-stream.ts) | [Tail tests](../../packages/core/tests/log-tail.test.ts), [stream tests](../../packages/core/tests/log-stream.test.ts): rotation, filtering/read budgets, oversized lines, capacity, output/backpressure and disconnect cleanup; app tests retain sysadmin/linked-target boundaries | Passed / pending `tests`, `production` |
| S08i — Restart response delivery | [PM2 helper](../../example/modules/settings/helpers/pm2.ts), [controller](../../example/modules/settings/controllers/settings.controllers.ts) | [Response tests](../../packages/core/tests/restart-response.test.ts): complete 202 before commands, pre-finish cancellation, identity replacement and bounded failures; app audit/order case and real PM2 HTTP self-restart | Passed / pending `tests`, `production` |
| S08j — Browser transport policy | [Browser guide](../../example/docs/browser-auth.md), [Passport](../../example/modules/auth/helpers/passport.ts) | [App tests](../../example/tests/app.test.ts): no Set-Cookie, reject cookie/URL credentials and non-JSON refresh, explicit Bearer CORS headers | Passed / pending `production`; real browser S16.4, cookie adapter conditional |
| S08k — Refresh theft-response policy | [Auth helper](../../example/modules/auth/helpers/auth.ts), [client contract](../../example/docs/browser-auth.md) | [App tests](../../example/tests/app.test.ts): duplicate winner invalidation, ancestor replay, other-device isolation, delayed winner, invalid/expired tokens and acknowledgment loss before/after commit | Passed / pending `production`; replica-set failover S15.3 |
| S08l — Authority during SSE | [Access checker](../../example/modules/auth/helpers/access-check.ts), [lease](../../example/modules/settings/helpers/access-lease.ts) | [Stream tests](../../packages/core/tests/log-stream.test.ts): timeout, stale decision, pending capacity and failure; eight app cases revoke role/user/session/token/credential authority after SSE opens and require bounded EOF | Passed / pending `tests`, `production` |
| S08m — Early stream drain | [Core cleanup](../../packages/core/src/boot/cleanup.ts), [settings hook](../../example/modules/settings/module.config.ts) | [Boot](../../packages/core/tests/boot.test.ts), [stream](../../packages/core/tests/log-stream.test.ts), [queue](../../packages/core/tests/queues.integration.test.ts) and app tests: idle/active/pending streams, ordinary requests/jobs, failed/stuck hooks, repeat shutdown and fresh later boot | Passed / pending `tests`, `production` |

The [security model](../security-model.md) describes cumulative controls and their
limits; [migration guidance](../../packages/core/MIGRATING.md) describes adoption.
Generated implementations live in the core CLI templates and are checked against
the linked reference files. Test names/scenarios, not counts alone, define the
regression obligations. Earlier failures/results remain in the
[S08a–S08m history](production-readiness-02.md#s08-change-sets).

## Complete local verification

The closeout runs the existing [testing procedure](../testing.md) with temporary,
loopback-only MongoDB and Redis and no integration skips. Raw output remains in
ignored `reports/s08-closeout-*.log`, the workspace audit JSONL and
`reports/scaffold-{minimal,production,production-offline}/`. The temporary service
processes/data are cleaned up after validation.

| Check | Result / scope |
|---|---|
| Framework/spec coverage | 225 tests passed, no skips; 82.01% statements, 68.7% branches, 86.74% functions, 84.14% lines; unchanged boot/ACL/env floors |
| Reference production suite | 55 passed, no skips, including HTTP stream shutdown and fresh boot admission |
| Types | Test contracts, packages and synced reference app passed |
| Builds/archive checks | Both package prepack builds and archive identity/content/digest verification passed |
| Generated/reference parity | Modules, app tests, Vitest config, route prefix, nginx, browser guide and agent guides passed |
| Packed minimal | Exact archives installed outside workspace; generated types/tests/specs, HTTP startup and shutdown passed without application services |
| Packed production | 55 generated tests, types, deterministic offline/runtime specs, backend/worker shutdown and isolated PM2 HTTP self-restart passed |
| Packed production offline-only | Separate installation with no application service configuration; declarations and two byte-identical document generations passed with sockets denied and empty secrets |
| Audits | Workspace/runtime and complete generated inventories passed existing severity gates; moderate/deprecation notices remain visible in raw reports |
| Documentation | Relative links/anchors, cumulative status wording and whitespace checked; no runtime or test changes |

Archive digests for the locally verified bytes:

- `core-0.9.0-rc.2.tgz`: `sha512-jAP+QihYfYbvAdi0Okp3cC3hm/v3Ryh9fR4w9TPm9vdBuyGkrT1/LHt+QSdmm9h52/zpUMEHGh1E51On0jGPow==`
- `spec-0.3.0-rc.2.tgz`: `sha512-0Ufj1I2HZKIOxkVa1BxgeAh9MN9yyXT9GNRYNbVIGRZINMVclUln2kJkNkYTzKcWwoPlbeD8e3nI9n0Cmz1wlw==`

No clean-source release attestation or Linux result is implied by these digests.

## CI acceptance remains open

Read-only query:
`gh run list --commit 1be808c58d2f0155a785796d3c7964f96a5f70ae --limit 10`
returned no runs; retained output: `reports/s08-closeout-ci.json`.
The latest observed successful CI run was for older source `041d169`:
[historical run](https://github.com/kemora13conf/bp-backend-express/actions/runs/34391892263).
It does not validate Sprint 02 changes.

The [existing reusable workflow](../../.github/workflows/verify.yml) must establish:

- `tests`: Ubuntu, minimum Node 24.0.0 and current Node 24, integration coverage,
  types and agent-guide parity.
- `pack`: package builds/archives, workspace audit and production scaffold parity.
- `minimal`: Ubuntu and macOS packed minimal on current Node 24.
- `offline`: Ubuntu production offline-only with no application services.
- `production`: Ubuntu generated suite, backend/worker and real PM2 checks.

Owner: engineer/release maintainer. Attach successful workflow links, source commit
and matching archive digests before checking off 02-C3/02-C5. The local documentation
change does not authorize a push or workflow publication. Sprint 02 therefore
remains open solely for candidate CI evidence and final acceptance; implementation
and local documentation/verification are complete.

## Deployment follow-ups and accountable roles

These are assigned to existing program tasks, not silently added implementation
requirements. Roles identify responsibility; actual people and a named pilot must
be selected under S15.1 before deployment execution. No pilot owner or deployment
result is invented here.

| Gap / decision | Program task | Accountable role | Required acceptance evidence |
|---|---|---|---|
| Real nginx/TLS hops, forged headers, backend isolation and SSE proxy behavior | S15.1–S15.2 | Pilot/operator owner with engineer | Named topology and live ingress tests |
| Replica-set loss and uncertain refresh/audit acknowledgments; Redis outage/recovery | S15.3 | Engineer with database/operator owner | Disposable replica-set failure results before/after commit, recorded uncertain outcomes |
| Rolling restarts, active work and cross-process PM2 race/partial outcomes | S15.4 | Engineer with process/operator owner | Actual deployment drain/restart observations and decision on coordination |
| Restore, rollback and credential/session migration | S15.5 | Pilot/operator owner | Measured restore objectives and rehearsed rollback runbook |
| Filesystem ancestors, database roles, daemon access and secret handling | S16.1 | Security/operator owner | Pilot privilege review and scoped operational fixtures |
| Audit retention, archive, storage alerts and access | S16.2 | Audit/data owner with operator | Named retention/destination, archive/restore tests; request records distinguished from completion |
| Refresh reuse, credential failures and uncertain-operation alerts | S16.3 | Security/incident owner | Sanitized signal delivery, thresholds and response runbook |
| Actual browser bearer flows; cookie/CSRF adaptation only if chosen | S16.4 | Application/frontend owner with security reviewer | Browser preflight/origin/refresh/reconnect tests; conditional cookie flags and cross-site abuse tests |
| Auth/settings/SSE, queue and socket load across replicas | S16.5–S16.6 | Engineer with pilot/operator owner | Latency, resources and stream-lease observations; decision on global capacity/quota/restart controls |
| Independent security assessment | S16.7 | Maintainer appointing an independent reviewer | Findings with severity, owner and closure evidence |

See [Sprint 06 task definitions](production-readiness-task-report.md#7-sprint-06--production-pilot-operational-evidence-and-release).
Cookie authentication remains conditional; provider extraction remains Sprint 03.
