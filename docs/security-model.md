# Production starter security model and remaining review

The production preset generates editable application policy: auth, users,
the `config` console, the `settings` log stream, logging and PM2 operations.
The minimal preset omits these modules. Neither preset constitutes a
completed external security audit.

S08a–S08m were implemented and verified locally and in Sprint 02 CI on the
0.10 line. 0.11 retired the surface four of them covered (S08a, S08d, S08g,
S08i: the restart endpoint, the variable and translation editors and their
audit) and changed how two of them are kept (S08b, S08k: a read cache in
front of the database path). Each section below says which; dated
dependency entries remain historical observations.
The [Sprint 02 evidence map](sprints/production-readiness-02-evidence.md) links
implementation and abuse tests, records accepted CI evidence and identifies
remaining deployment verification.

## Boundaries and controls

Untrusted clients reach Express through the operator's TLS reverse proxy. Trusted
middleware resolves identity before RAI checks, and the ACL fails closed for
unknown roles or denied permissions. Since 0.12 a RAI id is
`module:scope:resource[:extra]`. The scope (`bo`, `web`, …) is a label the
ACL does not interpret: it is not a network or tenancy boundary, and a
back-office endpoint is protected by the roles granted its id, never by the
word `bo` in it. A prefix grant (`users:bo:*`) reaches every id under it,
so review prefix grants as carefully as `*`. Since 0.11 configuration has two layers:
the environment holds what boot needs before the settings store answers (the
port, the connection strings, the log destinations) and the secrets, and is
read-only at runtime; everything else is a setting, declared with a schema in
the owning module, stored per deployment (MongoDB `settings` collection in the
production preset), and written through `PATCH /config/:module` — `admin` may
read the console, `sysadmin` alone may write, and every write is validated by
the schema, refused on a stale version, audited to `config_audit_events`
without its values before it lands, and applied in every replica. Sysadmin
access also includes the log stream; keep that role separate from ordinary
administrators. Operators must restrict infrastructure networking and protect
environment files, backups and logs. JWT signing keys and admin credentials are
deployment secrets and are never readable through the console.

Staging and production boot reject blank or known development signing keys,
seed passwords/default admin identity, and identical access/refresh keys. Errors
name variables without their values. The guard is deployment validation, not a
password-strength estimator. Set unique random keys and an operator-owned admin
identity; environment validation alone does not check this policy until boot.

Retained tests exercise concurrent refresh rotation (one winner whose family is
then revoked by reuse), refresh replay,
logout invalidating old and rotated access/refresh tokens, and HTTP 500 responses
without internal error messages or stack traces in production. PM2 compatibility
is checked with a disposable daemon and actual process restarts. These checks
establish specific behavior; they do not prove all administrative paths safe.

## Deployment verification still required

Before a production pilot, review and test:

- Proxy trust configured for the exact deployment hops; proxy-aware rate limits
  for auth and administrative endpoints; secure headers and restrictive CORS.
- Client refresh coordination and incident response under the S08k policy below;
  retain password-change and concurrent-session regressions during adaptations.
- Audit durability for every settings write; role boundaries and omission of
  administrative modules; log redaction and the log stream's bounds.
- CSRF protection and cookie flags if an operator moves bearer tokens into
  cookies. See the [browser authentication guide](../example/docs/browser-auth.md)
  for the current transport contract and cookie-adaptation requirements.
- TLS, credential provisioning, backup/restore, process isolation, least-privilege
  database access, dependency updates and load/recovery behavior.

Sprint 02 retains abuse tests for the controls below. Sprint 06 tasks S15–S16
carry the deployment checks, with accountable roles and required results listed
in the evidence map. Report suspected vulnerabilities using [SECURITY.md](../SECURITY.md).

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

## Dependency review, 2026-10-07

Two high advisories reached PM2's transitive tree after 0.10.1, both denial
of service and both outside any request path: basic-ftp
([GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r),
used by get-uri only to fetch an `ftp://` proxy configuration) and braces
([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
used by chokidar to expand the watch globs an operator writes). The
workspace and every generated production app override basic-ftp to the
patched 6.2.1 line, one major above the range get-uri declares; the braces
advisory has no fixed release (3.0.3 is the latest), so it is muted through
`pnpm.auditConfig.ignoreGhsas` with this entry as the reason. The audit gate
prints muted advisories and still fails on any unmuted high or critical
finding; revisit both when PM2 updates its dependencies.

## Release audit follow-up, 2026-09-09

The rc.1 publication gate found a newly listed high-severity advisory affecting
js-yaml 4.3.1. npm publication was blocked. rc.2 pins PM2's transitive js-yaml
to 4.3.2 through a targeted Yarn resolution in the repository root and generated
production app. Packed checks preserve this resolution and still exercise PM2
start/restart. Remove the override once PM2 declares a patched version upstream.
[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

## S08a — Administrative restart scope

Retired in 0.11. `POST /settings/reboot` and the PM2 restart helper are gone:
nothing needs a restart to take effect, since settings apply live and a
restart-tagged field says so in the write's response. PM2 operations stay
with the operator's shell (`pnpm pm2:*`). The retained check is that PM2
starts both TypeScript entrypoints with node and restarts them
(`scripts/pm2-smoke.mjs`, in the online production smoke).

## S08b — Session validity and revocation timing

Since 0.11 the auth module keeps a resolved session in the app cache (Redis in
production, shared by every replica) under its sid for `auth.cacheTtlSeconds`
(default 60, never longer than `accessTtl`). A hit skips the database reads
below; every path that revokes — logout, refresh rotation and reuse, a session
ended by its owner, a password change, a soft-deleted account, and any code
that writes a role (it calls `forgetUser()`) — deletes the entry before it
answers, so a revocation is refused on the very next request on any replica.
The cache is best effort: a Redis outage is a miss and the database path
decides; the TTL bounds the one window a deletion could be lost in, a Redis
outage at the moment of the revocation. The open log stream's re-check reads
the database, never the cache. The reference tests assert a warm request
performs no model read and that a revocation on one replica is refused at
once on a second.

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
and failure cases identified during S08b. At that stage, refresh replay rejected
only the presented token. The S08k policy below supersedes that behavior with
revocation of the device family.

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

Retired with the surface it covered; its principle moved to the `config`
module. `PATCH /config/:module` awaits a `ConfigAudit` insert — namespace,
field names, the version the caller read, actor, role, client IP; never a
value — with majority acknowledgment and journaling and a 5-second
write-concern timeout before anything is written to the settings store; an
unacknowledged audit is a 503 and no change. Records live in
`config_audit_events`, independently of `LOG_LEVEL` and the destinations.
There are no secret reveals to audit any more: the console never returns a
secret's value. The reference test for the proxy-trust path asserts the
audit record's IP; the console tests assert the record carries names and no
value.

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
S08f uses this IP policy for shared request limits.

The templates themselves are now exercised: `scripts/ingress-smoke.mjs` runs the
committed production template in an nginx container in front of a packed
production app and records what a client observes — forged `X-Forwarded-For`,
`X-Forwarded-Proto` and `X-Forwarded-Host` are all overwritten, an oversized body
dies at the proxy, and a client reaching the backend port directly does gain the
forwarded identity that the loopback trust grants it. See the
[ingress evidence](design/ingress-evidence.md). A pilot's own topology — extra
hops, TLS, replicas — is still an operator check; that evidence belongs to
[Sprint 06](sprints/production-readiness-06.md).


## S08f — Shared authentication and settings request limits

Redis fixed-window counters run before JSON parsing and Passport. Defaults per
client per minute are 20 combined credential POSTs, 120 total auth requests and
60 console requests (`/config` and `/settings`). Since 0.11 the quotas, the
window and the namespace are the `security.rateLimits` setting, validated by
the schema and rebuilt by the module's `onChange` when written; proxy trust,
CORS, HSTS and the body limit are settings in the same namespace, and none of
them is an environment variable any more. Replicas share atomic counters when
they use the same namespace, environment and quota configuration. Rejected requests do not extend
the window; responses use 429 with `Retry-After`. Store errors and stalled initial
connections/commands fail closed with sanitized 503 responses and one-second
bounds. Each boot owns its limiter connection and cleanup.

Client identity uses the proxy policy above, maps IPv4-mapped addresses to IPv4,
and groups IPv6 by /56. Invalid addresses share a bucket. Keys contain an address
digest, not credentials; that digest is not anonymization. Limits are editable
application policy: NAT clients share quotas, fixed windows permit boundary bursts,
and exhausting auth quota can also delay logout. IP quotas do not provide account
lockout or stop distributed attacks. Redis eviction/data loss resets counters;
operators own sizing, persistence and deployment tuning. See the
[quota migration contract](../packages/core/MIGRATING.md#unreleased--shared-production-request-limits).

## S08g — Constrained settings files

Retired in 0.11. The console no longer reads or writes `.env` files or
translation files: variables are read-only through `GET /config` (names,
types, sources, and a non-secret's resolved value), translations are code in
the repository, and settings live in the store the app declares. The file
store core ships for apps without a settings provider writes
`config/settings.<APP_ENV>.json` through an exclusive temporary sibling and
a rename, and never follows a request-supplied path. The log stream's file
rules (S08h) are unchanged.

## S08h — Bounded log history and streaming

Only the configured log basename and documented rotation suffixes are eligible.
Linked/non-regular targets are refused. History reads at most the last 256 KiB and
1000 complete lines, dropping fragments and lines over 16 KiB. Live tails read at
most 64 KiB per one-second poll and 8 MiB overall; directory scans stop after 1024
entries. Rotation/truncation resets cursors when observed; polling can miss entries.

Each controller permits four streams, at most two per account. Streams end at
60 seconds, credential expiry or 1 MiB of SSE output. Backpressure or a frame
exceeding the 64 KiB pending-output budget disconnects the reader; a pending end
has a separate one-second forced-close fallback. Disconnect stops tails and timers.
Outstanding authorization checks retain capacity until they settle under S08l.
S08l and S08m below add continuous authority checks and early shutdown signaling.
These are local caps; cross-replica capacity and realistic slow-reader/load results
remain deployment work. The
[stream migration contract](../packages/core/MIGRATING.md#unreleased--bounded-log-streaming)
describes limits, sanitized errors and client reconnection requirements.

## S08i — Restart acceptance before execution

Retired with S08a: there is no restart endpoint. A write to a field tagged
`.meta({ restart: true })` persists, applies on the next boot, and the
response says `requires_restart` with `meta.action: "restart_required"`; the
restart itself is the operator's.

## S08j — Browser authentication and cookie adaptation

The reference and generated production apps carry the same
[browser authentication guide](../example/docs/browser-auth.md). Access credentials
come from the Authorization header; refresh credentials come from a JSON body.
Cookie and URL credentials are ignored, and auth responses do not set cookies.
CORS controls browser response access rather than rejecting incoming requests.
Its credential flag does not install authentication or CSRF middleware.

The guide covers client credential storage, cookie attributes, session-bound CSRF
validation, exact-origin checks, login/refresh/logout coverage and browser checks
required for an application that adopts cookies. HTTP regressions retain the
existing transport boundaries; they do not simulate browser CORS or SameSite.
The S08k policy below completes the refresh theft-response decision.


## S08k — Strict refresh reuse revocation

The chosen policy revokes one device family when a valid, unexpired refresh token
is reused. The `sid` identifies the family; its row holds the only current refresh
ID. Refresh performs a single conditional update, scoped to owner, credential
version and a live expiration. A current token rotates normally; a noncurrent
one sets expiration to the Unix epoch. Access authentication, refresh and session
listing all reject that expired row before TTL cleanup. MongoDB's
[single-document atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
and [conditional update pipelines](https://www.mongodb.com/docs/manual/tutorial/update-documents-with-aggregation-pipeline/)
keep rotation and replay handling in the same write.

The replay request receives 401. All tokens in that family stop authenticating;
other devices survive. Concurrent duplicate refreshes produce one success and one
rejection, with no usable surviving pair once replay handling completes. This
chooses theft containment over transparent retries, following the rationale in
[RFC 9700 section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)
without claiming this starter implements OAuth. Clients must coordinate refresh
and sign in again after rejection or an uncertain outcome.

Refresh verifies signature, expiry, token type and required scalar claim shapes
before attempting a session write. An expired ancestor, malformed/forged token or
wrong-owner session cannot revoke a live family. Majority/journal acknowledgment
is requested; failures return sanitized REFRESH_UNAVAILABLE (503) without a pair.
Tests inject failure both before and after commit, since a missing acknowledgment
cannot establish whether the state changed. No token bodies enter the error.

The tests also retain multi-generation replay, other-device isolation, a delayed
winning response after revocation, expiry boundaries, logout and password-change
races. There is no cross-document transaction, new token field, grace window or
historic-token collection. Existing session expiration provides the revocation
state, and TTL later removes it. Detection requires reuse while the presented
ancestor is unexpired. Already authorized ordinary requests may finish. S08l
revalidates open log streams under the lease below; the refresh update itself does
not cancel them. Replica-set failover verification and an incident-alerting
pipeline remain explicit follow-up work.

## S08l — Authorization throughout an open log stream

Open settings log streams reload the original token's session owner, live expiry,
credential version and revocation status, then reload the user and evaluate the
current role for `settings:logs`. The controller repeats the check before file
access/SSE headers to cover changes since request authentication. Idle and active
streams recheck every second; a one-second check timeout and a lease measured from
the check's start limit stale output authorization to two seconds with a responsive
event loop. Each frame checks expiry before writing. Already-buffered bytes cannot
be recalled, and the existing one-second socket flush fallback is separate.

Role removal, user deletion, session deletion/expiry, access revocation, logout,
password replacement and refresh reuse all have retained HTTP cases against real
MongoDB. A normal refresh does not itself revoke the earlier access token.
Opening denials use 403; verification failures/timeouts use sanitized 503. Once
streaming begins, failed verification ends the response without exposing driver
errors. Other accounts retain their ability to open streams.

Only one verification runs per stream. Closing aborts cooperative work and keeps
the connection slot reserved until any outstanding check settles, including a
query that ignored cancellation. This bounds pending work across reconnects to
four checks per controller, two per account, but a persistent database stall can
exhaust stream capacity. It does not prove in-flight driver cancellation. The
[migration guide](../packages/core/MIGRATING.md#unreleased--bounded-log-streaming)
describes the new async helper contract, timing and operational limits.

S08h/S08k descriptions of streams retaining their opening authority are superseded
by this increment. S08m now signals streams before framework HTTP draining, as
described below. Cross-replica leases and deployment tuning remain open.


## S08m — Signal streams when shutdown begins

Settings now exports `onDrain`, an optional core lifecycle hook invoked before
HTTP/socket/worker drain actions. Async notifications and traffic draining share
the existing cleanup deadline; failures are aggregated and later cleanup is still
attempted. Resource disposal remains in `onShutdown` after drain attempts.

One log-stream manager belongs to each boot Environment. Draining permanently
stops admission for that boot, closes idle/active responses, stops tails/timers and
aborts cooperative authorization. Openings already waiting on authorization and
late arrivals return sanitized 503 `LOG_STREAMS_DRAINING`; checks that later settle
cannot resume output. Shutdown does not wait for an uncooperative query. A fresh
boot uses a fresh manager even if the module remains imported.

Retained tests cover real SSE plus ordinary request draining, invalid/failing/stuck
hooks, startup failure, repeated/reentrant shutdown, queue-resource availability,
late opens and pending checks. The reference/packed app tests also retain fresh
admission after another boot. Healthy streams no longer cause the HTTP drain
timeout. A blocked event loop, slow socket or uncooperative application/driver work
still needs the existing deadlines and supervisor; no new global cancellation or
cross-replica coordination guarantee is introduced. This completes the S08h/S08l
pre-drain signaling backlog; production topology/load evidence remains separate.
