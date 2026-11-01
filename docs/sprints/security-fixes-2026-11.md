# Security fixes — November 2026

Fixes for the full security audit run on 2026-11-01 against `c002863`. The
report is outside the repository, at `~/security-audit-skill/tulipes-js/run-1/`
(`REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, and
`vulnerabilities.html` for a readable overview). Branch: continue on
`feat/client-headers` after R02, or a new `fix/security-2026-11` branched from it.

Status: **planned**. Nothing below is implemented yet.

> The repository is public. This plan names unfixed issues; push it together
> with the fixes, not before. The high finding (SEC-01) affects every app
> generated with the production preset, so consider a quiet 0.13.x patch for it
> ahead of the rest.

## Where each fix lands

- **`example/`** for app code. The production preset copies it
  (`packages/cli/templates/app` is generated and gitignored), so a fix there
  reaches new apps. Apps already generated are user code: every app-code fix
  gets a step in `packages/core/MIGRATING.md`.
- **`packages/core`, `packages/socket.io`, `packages/mcp`, `packages/bullmq`**
  for framework code; these reach existing apps on upgrade.
- **Release:** R02 already makes the next core 0.14. These fixes ship in the same
  line, and a core bump repacks every package (`docs/releasing.md`).

## Confirmed findings

### SEC-01 — Socket.IO emit without an ack crashes the backend (high)

- `example/modules/users/sockets/users.sockets.ts:14`,
  `example/modules/hello/sockets/hello.sockets.ts:18`: call the ack only when
  `typeof ack === "function"`.
- `packages/socket.io/src/socket-manager.ts`: in `namespace()`, add an
  `nsp.use()` middleware that wraps `socket.on` so every listener a module
  registers runs inside a try/catch (sync throw and rejected promise). The error
  is logged with the module and event name, and the socket stays up.
- Tests: provider test where a handler throws and the process and other sockets
  stay alive; example test emitting `whoami` and `ping` without an ack.
- MIGRATING: the two handler lines; the provider boundary arrives on upgrade.

**Done when** an emit without an ack, and a handler that throws, leave the
backend serving HTTP.

### SEC-02 — `GET /users` lists every account to any user (medium)

- `example/modules/users/module.acl.ts`: drop `users:web:list` from `user`;
  admin and sysadmin keep it through `users:*`.
- `example/modules/auth/tests/auth.test.ts:1051–1089` uses `GET /users` as the
  user-level route for API-token tests: move those to `GET /auth/me`.
- New test: a registered user gets 403 on `GET /users`.
- Regenerate `example/docs/openapi.json`; update the users and permissions
  docs pages that show the grant. MIGRATING step.

### SEC-03 — Config console shows credentials inside URL values (medium)

- `packages/core/src/env/resolved.ts`: mask user-info in every `url`-typed
  value and default (`mongodb://u:p@a:1,b:2/db` → `mongodb://•••@a:1,b:2/db`)
  in `describe`, `snapshot()` and the `env:check` output; also mask a
  `password=` query parameter.
- Tests in core for single host, multi-host, no user-info and query password;
  example config-console test asserts no `MONGO_URI`/`REDIS_URL` value
  contains `@` user-info.
- Core CHANGELOG entry. No app change.

### SEC-04 — Soft-deleted seeded admin breaks every boot (medium)

- `example/modules/auth/bootstrap/seed-admin.bootstrap.ts`: look the account up
  with deleted rows included; if it is tombstoned, stop the boot with a clear
  message naming the account and the two ways out (restore it, or change
  `ADMIN_EMAIL`). Restoring silently would undo an admin's decision.
- Register (`web.auth.controllers.ts:78`) and back-office create
  (`bo.users.controllers.ts:69`): count including deleted rows, and map an
  E11000 on email to the same 422 `emailUnavailable` (also closes the
  duplicate-race hardening note).
- `bo.users.controllers.ts` softDelete: refuse deleting the `ADMIN_EMAIL`
  account.
- Tests for each path. MIGRATING step.

### SEC-05 — Session-started agent runs survive a password change (low)

- `example/modules/agents/helpers/runs.ts:36`: store the session's
  `credential_version` on a run started without an API token.
- `example/modules/agents/helpers/adapters/auth-identity.ts:25`: end the run
  `failed: credential_revoked` when the version is no longer current, as
  `isTokenLive` does for tokens; export the check from `@app/auth`.
- Test: start a run with a session, call `setPassword`, the next step ends the
  run with no further tool call. Runs created before the change carry no
  version: decide in the change whether they are allowed to finish or ended.
- MIGRATING step.

### SEC-06 — Login time reveals whether an email exists (low)

- `example/modules/auth/helpers/passport.ts:52, 60`: when the user or
  credential is missing, compare against a dummy hash computed once per
  `passwordRounds` value.
- Test: an unknown email calls `verifyPassword` once (spy, not timing).
- MIGRATING step.

### SEC-07 — Sign-out clears the cache before deleting the session (low)

- `example/modules/auth/helpers/tokens.ts:269` `endSession`, and softDelete in
  `bo.users.controllers.ts`: change the row first, then forget the cache.
- Close the remaining read-then-write window for `endSession`, `setPassword`
  and softDelete together: forget again after the write, so a request that read
  the old row in between cannot keep it cached. Also stop a cache hit from
  renewing the TTL past the access token's lifetime (`passport.ts:131`,
  `api-tokens.ts:99`), and have API-token cache hits check the credential version.
- Tests with a fake cache that records the order of calls. MIGRATING step.

### SEC-08 — Admin can soft-delete a sysadmin (low)

- `example/modules/users/controllers/bo.users.controllers.ts:39–45`: refuse 403
  when the target role's `level` (from `ctx.acl.role()`) is at or above the
  caller's; an unknown level counts as highest. Refuse self-delete and removing
  the last account with the highest role.
- Tests: admin → sysadmin 403, admin → admin 403, admin → self 403, sysadmin →
  admin 200. MIGRATING step.

## Leads that need a deployment check

These are fixed in source either way; the check decides how loudly the release
notes warn.

### SEC-09 — Unset `APP_ENV` means development

- `packages/core/src/boot/app-env.ts`: record whether `APP_ENV` was set. When
  it is unset, keep reading the development files but turn off revealed
  internals and keep the placeholder-secret guard on, and log a boot warning.
  The example's dev scripts set `APP_ENV=development` explicitly.
- Same rule in `packages/mcp`: no raw error messages unless the environment is
  explicitly development, and refuse `developmentIdentity()` on the HTTP
  transport (two hardening notes).
- Core tests for unset, development and production. **Decision D1** below.
- As built: the placeholder-credential guard was **not** extended to an unset
  `APP_ENV`. It would have stopped `pnpm worker`, `pnpm start` and `pnpm mcp`
  on every development machine (the tutorials run them without the variable,
  and the minimal preset's MCP config uses `developmentIdentity()` on stdio).
  The deployment page says to set `APP_ENV` on every server instead.

### SEC-10 — `publicDomain` reaches the root-run nginx script

- `example/modules/core/module.config.ts:23`: validate a hostname (dot-separated
  letter/digit/hyphen labels; nothing else).
- `example/scripts/deploy-nginx.ts`: validate again, assert the resolved path's
  directory is `sites-available`, and remove the file and link it wrote when
  `nginx -t` fails.
- Tests: the schema refuses `../x`, `a;b`, braces and newlines. MIGRATING step.

### SEC-11 — Redelivered agent job can repeat a write

- `example/modules/agents/helpers/adapters/mongo-run-store.ts:87`:
  `beginExecution` becomes an atomic claim (`executing: false` in the filter);
  a lost claim ends the segment without running tools. Apply the same lease to
  `resume()`.
- Test with the memory store: two concurrent `run(runId)` calls execute one
  write. MIGRATING step.

## Hardening notes

Grouped by how much they cost. SEC-12 to SEC-14 are part of this sprint;
SEC-15 and SEC-16 need a decision first.

### SEC-12 — Core and providers

- Trusted-proxy ranges: refuse IPv4-mapped ranges that cover all of IPv4
  (`::ffff:0.0.0.0/96`).
- Error handler: pass through the message only for known body-parser and
  Express errors; otherwise send the generic status text.
- `packages/core/src/http/pagination.ts`: cap `page`.
- `AgentRegistry.invoke()`: when a custom checker is set, refuse callers that
  pass no request; `tools()`/`manifest()` apply it too.
- `packages/bullmq`: workers run the same `safeParse` as producers.

### SEC-13 — App code in `example/`

- List-query policy (`core/helpers/query/policy.ts`, `stages.ts`): use
  `Object.hasOwn`, so `constructor`/`toString` give a 400, not a 500; pass
  `maxTimeMS` to populate.
- `listDeleted`: paginate.
- Password schemas: maximum 72 bytes, the bcrypt limit.
- Agents: `Object.hasOwn` for `run.decisions`; quote only tool names found in
  `job.byName` in the trajectory note; show and approve the parsed input, not
  the raw one.
- Logger: pino `redact` paths for authorization headers, tokens and passwords.
- `.envs/.env.development`: fix the "NOT committed" comment.
- MIGRATING steps for the lot, in one entry.

### SEC-14 — Docs

- Document `approval: "none"` as unsafe when a readable action returns other
  people's content.
- Security page: what the console shows, `APP_ENV` behavior, socket handler
  boundary.

### SEC-15 — Needs a decision (API or behavior change)

- **D2** Password change asks for the current password (or a login within the
  last N minutes). Changes `POST /auth/password` for clients.
- **D3** `PATCH /config/:module` requires `version`. Breaks a client that omits it.
- Per-account login backoff in addition to the per-IP limit.
- The config audit records each change's outcome, not only the request.
- A failing `onChange`: roll the value back, or answer 200 with a warning.
- Route and agent-action ids must start with the declaring module's name
  (completes R02; breaking for an app that borrows another module's id).
- Socket.IO handshake auth and an origin allowlist tied to `security.corsOrigins`.

### SEC-16 — Release and CI

- Pin third-party actions by commit SHA, the publish job first.
- `publish.yml`: refuse a version below the registry's `latest`.
- `tulipes update`: check the registry's version is semver before using it.

## Order of work

One commit per item, each after its checks pass:

1. SEC-01
2. SEC-02, SEC-03, SEC-04
3. SEC-05 to SEC-08
4. SEC-09 to SEC-11
5. SEC-12 to SEC-14
6. SEC-15 and SEC-16 after D1–D3

Release bookkeeping (versions, CHANGELOG, MIGRATING headings) stays with C05.

Checks per item, run locally and recorded here with their output:
`pnpm typecheck`, `pnpm test:types`, root `pnpm test` with `TEST_MONGO_URI`
and `TEST_REDIS_URL`, the example suite, presets
(`pnpm vitest run --root packages/cli`), and the site build when docs change.
CI and a release are separate steps that need their own authorization.

## Open decisions

- **D1 — `APP_ENV` unset.** Recommended: fail closed (internals hidden, guard
  on, boot warning) and keep booting. The alternative is to refuse to boot,
  which is louder but breaks a bare `node app.ts`.
- **D2 — current password on password change.** Recommended: yes. A stolen
  15-minute token otherwise becomes a permanent takeover.
- **D3 — required `version` on config writes.** Recommended: yes, in 0.14,
  since 0.14 is already breaking.

## Validation evidence

None yet.
