# Production starter security model and remaining review

The production preset generates editable application policy: auth, users,
settings, logging and PM2 operations. The minimal preset omits these modules.
Neither preset constitutes a completed external security audit.

## Boundaries and controls

Untrusted clients reach Express through the operator's TLS reverse proxy. Trusted
middleware resolves identity before RAI checks, and the ACL fails closed for
unknown roles or denied permissions. Sysadmin access includes secret settings,
logs and process operations; keep that role separate from ordinary administrators.
Operators must restrict infrastructure networking and protect environment files,
backups and logs. JWT signing keys and admin credentials are deployment secrets.

Staging and production boot reject blank or known development signing keys,
seed passwords/default admin identity, and identical access/refresh keys. Errors
name variables without their values. The guard is deployment validation, not a
password-strength estimator. Set unique random keys and an operator-owned admin
identity; environment validation alone does not check this policy until boot.

Retained tests exercise concurrent refresh rotation (one winner), refresh replay,
logout invalidating old and rotated access/refresh tokens, and HTTP 500 responses
without internal error messages or stack traces in production. PM2 compatibility
is checked with a disposable daemon and actual process restarts. These checks
establish specific behavior; they do not prove all administrative paths safe.

## Deployment and follow-on security sprint

Before a production pilot, review and test:

- Proxy trust configured for the exact deployment hops; proxy-aware rate limits
  for auth and administrative endpoints; secure headers and restrictive CORS.
- Password-change invalidation, concurrent session operations and refresh theft
  response. Decide and document whether reuse revokes the whole token family.
- Audit durability for every secret reveal/update; role boundaries and omission
  of administrative modules; log redaction, file traversal and restart targets.
- CSRF protection and cookie flags if an operator moves bearer tokens into
  cookies. The current Authorization-header flow is not a cookie/CSRF policy.
- TLS, credential provisioning, backup/restore, process isolation, least-privilege
  database access, dependency updates and load/recovery behavior.

The next sprint should turn each threat into an abuse-case test and a documented
control. Report suspected vulnerabilities using [SECURITY.md](../SECURITY.md).

## Dependency review, 2026-09-08

The locked `qs` update addresses the advisories observed in the workspace audit.
The generated production tree exposed high-severity js-yaml CPU-exhaustion
advisories through PM2 6. The starter now requires PM2 >=7.0.4 <8, whose npm
manifest pins js-yaml 4.3.1. The affected YAML normally comes from deployment
configuration; the release gate still requires a patched dependency. See
[PM2 releases](https://github.com/Unitech/pm2/releases) and the
[js-yaml advisory](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj).
CI retains separate workspace/runtime and complete starter audits. Lower severity
findings and deprecation notices remain visible; this is a dated inventory,
not a permanent claim that dependencies are vulnerability-free.

## Release audit follow-up, 2026-09-09

The rc.1 publication gate found a newly listed high-severity advisory affecting
js-yaml 4.3.1. npm publication was blocked. rc.2 pins PM2's transitive js-yaml
to 4.3.2 through a targeted Yarn resolution in the repository root and generated
production app. Packed checks preserve this resolution and still exercise PM2
start/restart. Remove the override once PM2 declares a patched version upstream.
[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
