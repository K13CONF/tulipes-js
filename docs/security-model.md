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

## S08a — Administrative restart scope

The reviewed helper previously selected every process in a PM2 daemon for an empty
request and passed names to restart. On a shared daemon, that could affect another
application, including one with the same process name. The corrected starter
limits selection to processes whose canonical PM2 working directory equals the
app root derived from the installed helper's location. The complete requested
name set is validated before restarting anything; unknown/out-of-scope names
return `INVALID_RESTART_TARGETS` (400), and an empty verified inventory returns
`NO_APP_PROCESSES` (503). Calls use numeric PM2 IDs, so names such as `all` have no
selector semantics. Repeated names do not duplicate restarts; cluster members are
restarted individually. Both generated and reference helpers share this behavior.

The application directory is the scope: processes deliberately sharing that exact
directory belong to the same app for this policy. Configure PM2 `cwd` accordingly;
missing, unavailable or different directory metadata never authorizes a restart.
The daemon and local filesystem remain trusted operator controls. A PM2 environment
marker permits attempting daemon access; it is not proof of application ownership.
Sysadmin authorization still comes from the existing settings RAI/ACL.

Self-restart remains last and may interrupt the HTTP response. Durable audit and
response-before-restart coordination remain S08 follow-up work. This bounded fix
does not complete the rest of the auth/settings review.

## S08b — Session validity and revocation timing

Access authentication and refresh rotation require the session to belong to the
signed token's subject and have an expiration strictly later than the application
clock. Refresh checks ownership, expiration and the current refresh ID in one
conditional update. An expired row cannot authorize either token while awaiting
MongoDB TTL cleanup, and it is omitted from the active-device list.

Retained HTTP tests cover expiry at the exact boundary with the row still stored,
an inconsistent session owner, and a password change within one JWT second. After
a completed password change, both devices' earlier access and refresh tokens fail;
the replacement pair and new password work. A refresh racing with session deletion
can return a pair before deletion, but that pair is unusable after revocation
completes. Requests already authenticated are not canceled by deleting a session.

The credential-version correction below addresses the login/password-change races
and failure cases identified during S08b. Refresh replay is rejected without
revoking the surviving token family; family-wide theft response remains an
application-policy decision.

## S08c — Password changes and in-flight session creation

Each password replacement writes a fresh random `Credential.version` together with
the password hash in one atomic document update. Local password verification
passes the version it verified to session creation. Registration and password
replacement pass their own newly written version; they never adopt a later one.
The password-change endpoint also requires its authenticated session's version to
match in the credential update, so a delayed request cannot overwrite a newer
password. Trusted provisioning/reset callers can deliberately omit that condition.
Sessions store that value as `credential_version`. Access, refresh and device
listing require it to match the current credential, in addition to owner and
expiration checks. The credential lookup selects only the version, not the hash.

Session creation checks validity after insertion, so a delayed login or older
password-change response cannot create a usable session after a newer change.
Cleanup deletes only sessions belonging to the replaced version. Delayed cleanup
therefore cannot delete newer sessions. A cleanup failure can leave rows until TTL
expiry, but those rows cannot authenticate or refresh. No MongoDB transaction or
replica-set requirement is introduced.

If the credential write fails before committing, the old password and sessions
remain valid. If cleanup fails after that write, the endpoint returns 500 but the
new password is already effective: retry login with it. Connection loss during the
credential write can leave its outcome uncertain; this flow does not promise
transactional rollback. Authentication already in progress may finish using its
earlier credential snapshot. Every subsequent authentication/refresh checks the
current version. A concurrent refresh may return a pair that is already unusable.

Controlled HTTP tests pause credential writes, session insertion and cleanup around a later password
change, inject write failures, and pause legacy credential upgrade around a reset.
Legacy credentials acquire a version on successful login, conditional on the
verified hash still matching. Existing sessions without a version require login
again. Deploy all auth helpers/controllers and models together; old running code
does not enforce the new check. `User.tokens_valid_from` is retained in the schema
for existing data but is no longer read or advanced by the starter's auth flow.

## S08d — Durable settings audit before action

The settings controller awaits an `AuditEvent` insert before a declared secret
reveal, environment-file change, translation-file change or restart attempt.
Records live in MongoDB's `settings_audit_events` collection, independently of
`LOG_LEVEL`, console/file destinations and log-stream filtering. Each insert
requires majority acknowledgment and journaling, with a 5-second write-concern
timeout. That timeout does not bound connection/server-selection delays.

If the audit model is unavailable or its write fails, the endpoint returns
`AUDIT_UNAVAILABLE` (503) before sending the secret, writing a file, changing the
process environment or calling PM2. Sink errors are not included in the response.
An uncertain acknowledgment can leave a stored record for an action that was
blocked; records explicitly describe requests, not successful completion.

The allowlisted fields identify the action, authenticated actor/role, observed IP,
environment, process mode, timestamp, variable or module/locale, and counts. No
old/new variable value, translation content, arbitrary details or raw restart
target names are stored. A zero restart target count means the default selection
of all verified application processes. IP remains informational until deployment
proxy trust is reviewed. Ordinary administrators remain outside the settings ACL.

The application only inserts these records; it does not expose an audit mutation
or browsing API. This is not a tamper-proof store: trusted application/database
operators can alter it. No automatic TTL or retention deletion is configured;
operators own archival, retention, storage monitoring and database access controls.
File writes and PM2 operations are not transactional with MongoDB. A later action
failure leaves its request record, without claiming the action completed. External
archival and completion/outcome correlation are outside this bounded correction.

## S08e — Explicit proxy trust and client IPs

The production security module sets Express proxy trust from `TRUST_PROXY_CIDRS`
at runtime. Empty (the default) uses the socket peer and ignores forwarded IP,
host and protocol headers. Configuration accepts explicit IPv4/IPv6 addresses or
CIDRs with nonzero prefix lengths; booleans, hop counts, named subnet aliases,
empty list entries and invalid addresses fail startup. Keep the list limited to
actual proxy peers; allowing broad networks can still trust unintended clients.

For a trusted peer, Express walks the forwarded address chain from the application
outward and selects the nearest untrusted address. Sessions and settings audits
both use the resulting `req.ip`. A forwarding-header value is only reliable when
the trusted proxies construct it correctly. Hostname and protocol also use
forwarded headers from trusted peers. See the [Express proxy guide](https://expressjs.com/en/guide/behind-proxies/).

The supplied nginx templates assume one public ingress proxy to a local IPv4
backend. They overwrite `X-Forwarded-For` with `$remote_addr`,
`X-Forwarded-Host` with `$host`, and `X-Forwarded-Proto` with `$scheme`.
For that exact topology, set `TRUST_PROXY_CIDRS=127.0.0.1/32` and restrict access
to the backend port. Additional upstream proxies require an explicit trust/header
policy in both nginx and the app; these templates do not recover client addresses
behind another load balancer automatically. Local processes are trusted when the
loopback peer is trusted.

Retained Express HTTP tests cover direct/untrusted peers, spoofed earlier entries,
trusted intermediate hops, IPv6/mapped IPv4 and invalid configuration. The packed
app test checks that session origins and audit records agree on the selected IP.
This establishes IP handling for subsequent rate-limit work; it does not add rate
limits. Live nginx deployment/topology validation remains an operator check.
