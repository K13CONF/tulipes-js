# Sprint 06 — Production pilot, operational evidence and release

Status: started 2026-09-12 from `40160ac` (core 0.10.0-rc.3 and the first
`@tulipes/cli` published). S15.2 (ingress) is delivered; **the rest of S15, all
of S16 and S17.1 cannot start without inputs this repository does not contain**
— see §2. S17.2–S17.6 follow the pilot.

Program: [Sprint 06 task definitions](production-readiness-task-report.md#7-sprint-06--production-pilot-operational-evidence-and-release).

## 1. What this sprint is not

Sprints 03–05 were repository work: measurable, reproducible here, finished by
CI. Sprint 06 is an operations sprint. Its tasks name a pilot application, an
owner, a topology, agreed latency and recovery targets, a staging environment,
a browser, sustained concurrency across replicas and an independent reviewer.
None of those exist in this repository, and none can be invented: a target
chosen here would be a number the framework measured against itself, and an
"independent" review by the implementing author is not one.

What **can** be done here is the part that only needs the committed artifacts
and disposable local infrastructure: running the real ingress template, real
service-failure topologies, and the lifecycle already exercised by the PM2
smoke. Those produce evidence a pilot can build on rather than replace.

## 2. Blocked on inputs (what to provide)

| Task | Needs | Smallest useful answer |
|---|---|---|
| S15.1 acceptance sheet | the pilot app, its owner, topology, workload shape, latency/error targets, resource budgets, RTO/RPO | fill §3 |
| S15.3 service failure | a disposable MongoDB **replica set** and Redis the pilot may lose on purpose | "use throwaway containers" is enough to unblock; production-like sizing is better |
| S15.4 lifecycle | the deployment method actually used (PM2 as generated, systemd, containers, a platform) | name one |
| S15.5 backup/rollback | where backups live, who restores them, what "acceptable data loss" means | name the destination and the owner |
| S16.1 privileges/secrets | the deployment's database roles, network boundaries, secret store | a description is enough to review |
| S16.2 audit retention | retention period, archive destination, who may read it | three lines |
| S16.3 incident signals | where alerts go and who answers them | the destination |
| S16.4 browser flows | a browser against a deployed origin (and a decision on cookie auth, which remains unadopted) | confirm bearer-only, or ask for cookies |
| S16.5–S16.6 load | permission to run sustained load against the staging environment, and its replica count | the environment and a window |
| S16.7 independent review | a reviewer who is not the implementing author | a name |

Until those arrive, the honest status of every one of those tasks is "not
started", not "assumed".

## 3. Pilot acceptance sheet (S15.1) — to be completed by the pilot owner

Numbers are deliberately blank: the task forbids inventing a universal target.

| Item | Value |
|---|---|
| Application, owner | |
| Topology (replicas, ingress, database, Redis) | |
| Supported runtime / services | Node 24.x; MongoDB 8, Redis 7/8 as tested in CI |
| Workload shape (endpoints, request mix, peak concurrency, job rate, SSE/socket clients) | |
| Latency targets (p50/p95/p99 per endpoint class) | |
| Error budget (5xx rate, failed jobs, dropped streams) | |
| Resource budgets (CPU, RSS, file descriptors, connections per replica) | |
| Recovery time objective / acceptable data loss | |
| Restart and deployment window | |
| Sign-off: who accepts the result | |

## 4. S15.2 — ingress, delivered

`scripts/ingress-smoke.mjs` runs the **committed** production nginx template in
an `nginx:1.27-alpine` container in front of a packed production app with a
disposable database, and records what a client observes. Full results and the
two findings: [ingress evidence](../design/ingress-evidence.md). Nine checks,
all passing, against `v0.10.0-rc.3` archives on 2026-09-12.

The one deviation from the deployed file is `proxy_pass` pointing at the host
gateway instead of `127.0.0.1`, because the proxy runs in a container and the
app on the host; every other directive is used verbatim.

## 5. Tracker

| Item | Status | Evidence |
|---|---|---|
| S15.1 | Blocked | §3 sheet awaits the pilot owner |
| S15.2 | Complete | [ingress evidence](../design/ingress-evidence.md); `reports/ingress-smoke/` |
| S15.3–S15.5 | Blocked | §2 |
| S16.1–S16.7 | Blocked | §2 |
| S17.1 | Blocked | follows the pilot |
| S17.2–S17.6 | Not started | after the pilot; the release procedure itself is exercised and documented |
