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

Candidate line: core 0.9.0-rc.3 and spec 0.3.0-rc.3, released under `next`.
Spec rc.3 requires core `^0.9.0-rc.3`; upgrade the pair together. The candidate
includes Sprint 02 offline inspection and security controls; provider extraction
and production-pilot acceptance remain later work.
Candidate fixes target this pair; the stable support lines below remain in
effect until 0.9.0 becomes stable. The workspace additionally carries the
unreleased `@tulipes/mongoose` provider (Sprint 03): the next candidate ships
it as a third package, with the core/provider/spec ranges set in that release
PR, and core stops installing Mongoose from that version on.

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
