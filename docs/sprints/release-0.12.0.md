# Release — core 0.12.0, the 0.12 line stable

Status: **prepared locally on 2026-10-14, branch `release/0.12.0`; not merged, not tagged, not published.** Publication follows [the release procedure](../releasing.md): a reviewed PR with green CI, then the `v0.12.0` tag on its merge commit, which publishes every package to `latest`. Owning items: [the 0.12c plan](./0.12c-plan.md) (the four fixes) on top of [rc.2](./release-0.12.0-rc.2.md). The `v0.12.0-rc.2` tag was never valid (see rc.2's tracker) and is not reused.

## Scope

- Everything rc.1 and rc.2 carried, plus the 0.12c fixes: `tulipes spec` with `publicDomain` as an environment value, settings declared with a module's own zod 4, one banner `Settings` row, the reference app's cache opened at boot.
- Versions: core `0.12.0`, `@tulipes/cli` `0.3.0`, `@tulipes/spec` `0.4.0`, `@tulipes/mongoose` and `@tulipes/bullmq` `0.2.1`, `@tulipes/testing` `0.1.1`, `@tulipes/socket.io` `0.1.3`, `@tulipes/mcp` `0.1.1`. Eight archives. Peer ranges: providers, testing and spec require core `^0.12.0`; socket.io and mcp `^0.11.0 || ^0.12.0`; the CLI's optional spec peer is `^0.4.0`.
- dist-tag `latest` for all eight; `CHANGELOG`, `MIGRATING` (headings `0.12.0`) and `docs/support.md` updated.

## Local evidence (macOS, Node 24.14.0, pnpm 10.28.0, 2026-10-14)

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm test:types` | pass, 0 errors |
| `pnpm test:coverage` | pass, floors met (93.1% statements, 89.4% branches) |
| example `sync` + `typecheck` | pass |
| `artifacts.mjs prepare` + workspace audit | eight archives at the versions above; no high/critical findings |
| scaffold parity diff (verify.yml `pack`) | identical |
| `scaffold-smoke.mjs minimal` | pass |
| `scaffold-smoke.mjs production --offline-only`, and `--no-queues --no-sockets` | pass, network denied |
| `upgrade-smoke.mjs` (0.11.0 → 0.12.0) | pass: refused, migrated (28 ids, 11 variables), installed, typechecked, offline, boots |
| example suite, dedicated Mongo + Redis | 44 passed, 2 failed: the rate-limit pair that fails on this Mac on master too (201 parallel connects vs `kern.ipc.somaxconn=128`) |
| `scaffold-smoke.mjs production` (services) | reaches the scaffold's suite, which fails the same pair |

To record from CI on Linux: the example suite and the production smoke green, `failure-smoke`, `ingress-smoke`, `pm2-smoke`. Not run locally: those three harnesses.

## After the tag

Verify each package's registry integrity and digest against the workflow manifest, the dist-tags, then `scaffold-smoke.mjs <artifacts> minimal --registry` and the production variants, per the procedure.
