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

Candidate line: core 0.10.0-rc.1, spec 0.3.0-rc.4 and the first provider
`@tulipes/mongoose` 0.1.0-rc.1, released under `next`. Spec rc.4 admits core
`^0.9.0-rc.3 || ^0.10.0-rc.1`; the provider requires core `^0.10.0-rc.1` and the
app's own `mongoose ^8`. Core 0.10 no longer installs Mongoose: apps with models
select the provider in `package.json` (Sprint 03); Sprint 02 offline inspection
and security controls are included; production-pilot acceptance remains later
work. The previous candidate pair, core 0.9.0-rc.3 / spec 0.3.0-rc.3, stays
installable under its own versions.
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
