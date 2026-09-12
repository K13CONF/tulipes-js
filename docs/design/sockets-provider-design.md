# Sockets provider design (S11)

Status: designed and delivered on 2026-09-12 as one change set (S11.1–S11.4
are inseparable for CI, as S09/S10 were) on top of the S10 seam. Builds on the
[Mongoose](mongoose-provider-design.md) and [queues](queues-provider-design.md)
designs; only differences are spelled out.

## 1. Attachment and availability (S11.1)

Socket.IO differs from the two earlier providers in one way: it needs the HTTP
server, which exists only in the backend process after routes mount. Today
`initSockets` ran in `startBackend` between `createServer` and `listen`, was
skipped during inspection, and `ctx.sockets` was undefined in worker/script.

| Situation | Before | After |
|---|---|---|
| backend | Socket.IO server created on the HTTP server, socket files run, listen | provider acquired in phase 8 on an **unattached** server (namespaces claimed, files run), `attach(server)` after routes mount and before `listen()`; identical observable order |
| backend, inspection | skipped entirely | provider **skipped** (`situations: ["backend"]`, situation `inspect`), listed as "not used in inspection", nothing imported |
| worker / script | `ctx.sockets` undefined | skipped the same way; `handle.providers` says so |
| offline inspection / `sync` | never imported | unchanged; declaration and `requires` validated |
| not selected | — | `ctx.sockets` undefined; a `sockets/` file is refused before import |

Authorization and connection handlers stay application code inside
`sockets.namespace(name, setup)`; nothing about namespace middleware moved.

## 2. Contract additions

```ts
export type ProviderSituation = "backend" | "worker" | "script" | "inspect";
export interface Provider { /* … */ situations?: readonly ProviderSituation[]; }   // default: all
export interface ProviderContext { /* … */ situation: ProviderSituation; }
export interface AcquiredResource { /* … */ attach?(server: http.Server): unknown | Promise<unknown>; }
export interface AcquiredStatus { /* … */ skipped?: ProviderSituation; }
```

- A provider outside its situations is recorded as skipped: no import of its
  files, no `own()`, a gray banner row, never a failure. This replaces the
  ad-hoc `if (!inspect) initSockets(...)`.
- `attach` runs in the backend after `loadRoutes` and the route scan, before
  `listen`; never during inspection. An attach failure is a `providers` boot
  error and the failed-boot cleanup disposes what was acquired.
- Shutdown: the provider's `drain` closes the Socket.IO server in the
  concurrent phase — where `cleanup.run("sockets", …)` used to be — so clients
  disconnect alongside the HTTP drain; the HTTP server's ownership stays with
  core (`http` step, forced `closeAllConnections`). `dispose` is a no-op.

## 3. Package and compatibility (S11.2, S11.4)

- `@tulipes/socket.io` 0.1.0-rc.1; `dependencies`: `socket.io ^4`; peer core.
  `SocketManager` now constructs an unattached `Server` and exposes
  `attach(httpServer)`; `SocketRegistry`, `SocketsFn`, `initSockets` move verbatim.
- Declaration `"tulipes": { "providers": { "sockets": "@tulipes/socket.io" } }`;
  a `sockets/` directory implies the requirement.
- Migration: root declaration + dependency, module dependency, `from
  "@tulipes/core/sockets"` → `from "@tulipes/socket.io"`. `@tulipes/core/sockets`
  is a migration stub. The upgrade smoke applies all three provider migrations
  from the published rc.3 starter.
- Generator, example, `new module --sockets/--no-sockets`, skills, README,
  CHANGELOG, MIGRATING updated; artifacts pack five archives and `verify`
  refuses a core depending on or declaring from `socket.io`.

## 4. Evidence (S11.3, S11.4; 2026-09-12)

| Claim | Evidence | Result |
|---|---|---|
| Live behavior retained | moved `packages/socket.io/tests/sockets.integration.test.ts`: a client on `/probe` receives the namespace's event, shutdown disconnects it and releases the listener; inspection skips setup and readiness hooks and lists the provider as skipped | pass |
| Situations | core fake-provider test: acquired and attached (`listening=false`) in backend only; worker (refused for zero consumers, not for the transport), script and inspection never acquire, attach or dispose and report `skipped` | pass |
| Attach failure | reported as `provider "…" failed to attach to the HTTP server: …`; the resource is drained and disposed | pass |
| Requirement | `sockets/` directory refused before import without a declaration | pass |
| Absence | minimal smoke probe: `socket.io` and `@tulipes/socket.io` unresolvable from app, core and launcher (with all earlier targets) | pass |
| Packed core | dependencies: colorette, dotenv, express, i18next, i18next-fs-backend, tsx, zod — no driver left | pass |
| Consumers | parity diffs, `new module` flags, packed production runtime (clients not exercised there; the integration test covers them), upgrade smoke (10 imports, 4 manifests) | pass |
| Suite | 256 tests with services, coverage 86/77/89/88, `test:types`, workspace and example typechecks, `yarn install --immutable` | pass |
