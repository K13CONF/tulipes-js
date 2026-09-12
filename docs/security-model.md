# Production starter security model and remaining review

The production preset generates editable application policy: auth, users,
settings, logging and PM2 operations. The minimal preset omits these modules.
Neither preset constitutes a completed external security audit.

S08a–S08m are implemented and verified locally and in Sprint 02 CI. This document describes their
cumulative behavior; dated dependency entries remain historical observations.
The [Sprint 02 evidence map](sprints/production-readiness-02-evidence.md) links
implementation and abuse tests, records accepted CI evidence and identifies
remaining deployment verification.

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
- Audit durability for every secret reveal/update; role boundaries and omission
  of administrative modules; log redaction, file traversal and restart targets.
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

Self-restart runs last. S08d adds durable audit before PM2 access and S08i adds
complete HTTP acceptance handoff before execution, as described below. These
supersede the response/audit follow-ups recorded at the S08a checkpoint.

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
60 settings requests. Replicas share atomic counters when they use the same app
namespace, environment and quota configuration. Rejected requests do not extend
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

Settings reads and writes refuse symlinked configured directories/files, hardlinked
files and non-regular targets. Descriptor reads and writes have a 1 MiB ceiling;
directory enumeration, JSON depth/node counts and missing-key expansion also have
explicit bounds. Environment values must round-trip through dotenv without changing
unrelated effective values. Replacements sync an exclusive temporary sibling before
rename, preserve the old file on pre-rename failure and write env files as 0600.
The live environment changes only after the file write succeeds.

Unsafe, oversized, invalid and unavailable inputs have distinct sanitized errors.
These checks require trusted operator-controlled directories and ancestors; they
do not sandbox hostile local writers racing directory replacement. There is no
cross-process edit lock or directory-entry power-loss guarantee. Custom file
metadata is not preserved by replacement. The
[file migration contract](../packages/core/MIGRATING.md#unreleased--constrained-settings-file-access)
records exact limits and compatibility constraints. Audit acknowledgment precedes
mutation and records a request, not proof of successful completion.

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

After durable audit and complete target validation, the endpoint returns 202 with
`accepted` and `scheduled`. The response finish event releases PM2 execution;
close/error before finish cancels it. This establishes complete handoff to the
operating system, not remote receipt or restart completion. Each numeric target's
canonical directory, name and PID are checked again before execution; self runs
last. A local lock isolates shared PM2 client use, and callbacks/response completion
have five-second bounds. Errors after acceptance emit a stable stderr signal
without a second HTTP response.

Earlier targets may restart before a later failure, and a timed-out command may
have reached PM2. No durable job, rollback or completion endpoint is provided.
Cross-backend coordination and the inventory-check/command race remain deployment
limitations. See the
[restart migration contract](../packages/core/MIGRATING.md#unreleased--restart-acknowledgment-before-execution).


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
