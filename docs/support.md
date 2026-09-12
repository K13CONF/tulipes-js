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

Candidate line: core 0.10.0-rc.3, the command line `@tulipes/cli` 0.1.0-rc.1,
spec 0.3.0-rc.6 and the providers `@tulipes/mongoose` 0.1.0-rc.3,
`@tulipes/bullmq` 0.1.0-rc.2 and `@tulipes/socket.io` 0.1.0-rc.2, released
under `next`. The `tulipes` command now ships in its own package: install it
globally and as an app devDependency. Spec rc.4 admits core
`^0.9.0-rc.3 || ^0.10.0-rc.1`; mongoose requires core `^0.10.0-rc.1` and the
app's own `mongoose ^8`; bullmq and socket.io require core `^0.10.0-rc.2`. Core
0.10 installs no database, queue or socket driver: apps select providers in
`package.json` (Sprints 03–04); Sprint 02 offline inspection and security
controls are included; production-pilot acceptance remains later work. Earlier
candidates stay installable under their own versions.
Candidate fixes target the current triple; the stable support lines below remain
in effect until a 0.x line becomes stable.

The current released lines are core 0.8.x and spec 0.2.x. Normal fixes target
these lines. Critical security fixes for the previous core minor (0.7.x, with
spec 0.1.x) are evaluated until the next core minor is released; where a safe
backport is impractical, the advisory must explain the required upgrade. This
is a best-effort maintenance commitment, with no guaranteed response time.
Update this table of maintained lines in each release PR.

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
