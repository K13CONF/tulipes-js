# Support, ownership and compatibility

Tulipes is an experimental, opinionated TypeScript framework for modular Express
applications with strict boot-time validation. It is MIT licensed. Maintenance
and release ownership belong to GitHub `@kemora13conf`, npm `by_kemora_13`;
contact abdelghanielmouak@gmail.com. Contributions are welcome through the
restricted repository or this contact. Repository and issue links in package
metadata require access. Source visibility is outside this sprint.

## Runtime and platform scope

The 0.9 candidate declares **Node >=24.0.0 <25**. CI tests Node 24.0.0 and the
latest available 24.x on Ubuntu with MongoDB 8 and Redis 7. The minimal packed
starter is additionally tested on macOS. Other Node lines and Windows are not
currently claimed as supported. Node upgrades require expanding CI first.

## Pre-1.0 policy

Current stable line, published to `latest`: core 0.10.0, `@tulipes/cli` 0.1.0,
`@tulipes/spec` 0.3.0, and the providers `@tulipes/mongoose`, `@tulipes/bullmq`
and `@tulipes/socket.io` at 0.1.0. The `tulipes` command ships in its own
package: install it globally and as an app devDependency. Each provider
requires core `^0.10.0`; spec also accepts the 0.9 candidate line.

**Stable is a statement about the API, not about production hours.** The 0.10
contracts are settled and breaking changes wait for 0.11; every supported
journey is exercised by CI on each commit, and the operational harnesses in
`scripts/` cover real nginx ingress and MongoDB/Redis failure. No production
pilot has run this framework yet: there is no load, backup-restore or
multi-replica evidence, and no independent security review. Sprint 06 of the
[production readiness programme](sprints/production-readiness-06.md) lists
exactly what is missing. Choose it accordingly.

Core 0.10 installs no database, queue or socket driver: an app declares the
providers it wants in `package.json`, and the app's own `mongoose ^8` stays its
dependency. Sprint 02's offline inspection and security controls are included.

Maintained lines, to be updated in each release PR:

| Line | Status |
|---|---|
| core 0.10.x, cli 0.1.x, spec 0.3.x, providers 0.1.x | current; normal fixes target these |
| core 0.9.x | candidates only (`next`); superseded by 0.10.0 — upgrade rather than expecting fixes |
| core 0.8.x, spec 0.2.x | previous stable; critical security fixes evaluated until the next core minor ships, where a safe backport is practical |
| core 0.7.x and older | unmaintained |

This is a best-effort maintenance commitment with no guaranteed response time.

Patch releases preserve documented behavior except for clearly documented
security corrections. A 0.x minor may change public contracts and must include
migration instructions. Structural changes first ship as a prerelease under
npm's `next` tag. Stable releases use `latest` after the same checks. Published
versions are immutable; fixes receive new versions.

The supported API consists of documented package exports, exported types, module
file contracts, CLI commands and documented HTTP behavior. Internal source or
dist paths, private Express internals, and undocumented properties have no
compatibility guarantee. Generated auth, settings and operational policy are
editable application code, separate from the core API.

Before 1.0: separate optional providers, complete offline inspection and focused
security review, document deprecations, and validate a real production pilot
including deployment, load and recovery. Test count alone does not satisfy this
milestone.
