# Sprint 01 — Package trust and a verifiable first run

Status: implementation authorized, 2026-09-08, with repository visibility explicitly excluded. The original plan below is retained as the rationale and baseline; this status section supersedes its pending-decision wording.

## Implementation scope and results

- S01: merged the previously released PR into master; added MIT licenses, metadata, Node 24 engines, ownership, contribution, security and support policies. Source/CI remain private. Disclosure uses the existing public npm owner contact.
- S02: reusable minimum/current Node 24 CI, measured coverage floors, runtime and starter audits, exact packed-artifact installation on Linux/macOS, and tag/ancestry/digest publication gates. Token authentication remains available; optional OIDC needs npm account configuration. Private-repository provenance is excluded. No new version or tag is published by this implementation.
- S03: default minimal, --minimal/--preset minimal and explicit production, parser regressions, generated Vitest suites and real HTTP tests. Minimal health and hello require no MongoDB/Redis and include security headers.
- S04: staging/production credential guard, concurrent refresh/logout regressions, production 500 redaction, qs update and PM2 7.0.4 upgrade with isolated start/restart checks. Audits retain lower severity findings.
- S05: corrected quick-start URLs, tested tutorial commands, CLI infrastructure requirements, compatibility/migration and release recovery documentation.

Sprint 02 is now in progress: see [its backlog and implementation status](production-readiness-02.md).

Follow-on scope remains offline declaration/inspection, provider package extraction, full administrative/authentication security review and production pilot. A minimal runtime still installs the core package's provider dependencies. Publication requires a separate version/release change and the completed gates.

Validation details are maintained in docs/testing.md and the implementation PR. The original estimates below describe the full sprint capacity rather than actual elapsed time.

Baseline: `@tulipes/core@0.8.0`, `@tulipes/spec@0.2.0`, tag `v0.8.0`, commit `66dbf93`. The production-readiness proposal is the program backlog. This sprint delivers its first bounded increment.

**Sprint goal:** a user can install the published CLI, generate a minimal API, and run and test it without MongoDB or Redis. Maintainers can show that the exact packages published passed automated checks, with clear ownership, compatibility and migration information.

**Capacity assumption:** one engineer for ten working days, with a maintainer available for licensing, repository and publishing decisions. Budget eight days for implementation and two for review, integration and contingency. Estimates are planning assumptions, not elapsed-time guarantees. Start dates remain unset.

## 1. What is already done, and what remains

The supplied assessment needs these corrections against the released code:

| Workstream | Verified baseline | Remaining work |
|---|---|---|
| Governance | npm packages exist. Spec declares MIT and a repository. GitHub reports the repository is private, issues enabled, and no recognized license. | Core lacks license, repository, homepage, bugs, keywords and engines. No tracked LICENSE, SECURITY or CONTRIBUTING documents were found. Source and CI are not publicly inspectable. |
| Tests | Vitest is installed. The release commit passed 59 tests in CI, including MongoDB, Redis and Socket.IO cases, plus context type checks. | Coverage reporting, additional risk-focused regressions, a Node compatibility policy, and continuous testing of isolated packed installations. |
| Package modularity | Boot supports applications without configured MongoDB or queues. | Core still installs and imports infrastructure libraries; its context types also reference concrete implementations. Runtime optionality does not yet reduce installation dependencies. |
| Scaffolding | The full starter works and its modules are compared with generated output in CI. Generated auth helpers have regression tests. | No preset parser, minimal starter, generated test script or automated complete packed-app workflow. |
| Inspection | `inspect: true` skips bootstrap, sockets, listening and readiness. Routes preserve explicit mount prefixes and validate declarations. | It still resolves runtime environment values, runs config and route factories, initializes applicable Mongo/Redis infrastructure, and invokes shutdown hooks. It is not offline. |
| Documentation | Core has a changelog, migration guide and testing instructions. | CLI init still prints `/hello`; the reference route is `/api/v1/hello`. Commands, infrastructure requirements, ownership and stability guarantees need alignment. |
| Security | Async authorization, invalid decisions and guest isolation have regressions. Refresh rotation uses a conditional database update; settings has a sysadmin permission and audit helper. | These mechanisms need abuse-case tests. A code path or comment does not establish concurrency safety, complete audit coverage or production credential validation. |
| Releases | Tag publication works. Both packages built and published successfully for `v0.8.0`. | Publishing does not itself require the full test suite, test the exact tarball, or generate provenance. PR #1 remains a draft; the inspected default branch still contains core 0.7.1. |

Evidence: [core manifest](../../packages/core/package.json), [spec manifest](../../packages/spec/package.json), [CI](../../.github/workflows/ci.yml), [publishing](../../.github/workflows/publish.yml), [test instructions](../testing.md), [boot](../../packages/core/src/boot/boot.ts), [CLI parser](../../packages/core/src/cli/main.ts), and [scaffold](../../packages/core/src/cli/init.ts). GitHub visibility, PR state and npm metadata were checked on 2026-09-08.

A read-only `yarn npm audit --all --recursive --environment production --json` check reported two moderate `qs` advisories and one moderate deprecation notice for `cron-parser`; it reported no high or critical findings in that inventory. This is a dated dependency snapshot, not a security review. It excludes the separately installed starter's development/deployment toolchain, including its PM2 dependency. Reproduce and retain the reports in CI before deciding upgrades or exceptions.

## 2. Committed sprint backlog

Each item follows the existing proposal pattern: problem, suggested approach, acceptance criteria and relevant code. Tests belong to the implementation that introduces the behavior; do not add another test framework or a separate testing phase afterward.

| ID | Priority | Deliverable | Effort | Dependencies | Owner |
|---|---|---|---|---|---|
| S01 | P0 | Package identity, ownership and release baseline | 1 day | Maintainer decisions below | Maintainer + engineer |
| S02 | P0 | Exact-artifact CI and publication gates | 2.5 days | S01 metadata; public source for provenance | Engineer; maintainer configures npm trust |
| S03 | P1 | Minimal and production scaffold presets | 2.5 days | Agreed preset behavior; S02 harness for final verification | Engineer |
| S04 | P0 | Production credential guard and auth regressions | 1.5 days | Existing fixtures; packed starter from S02 | Engineer; maintainer reviews findings |
| S05 | P1 | Executable quick start and compatibility policy | 0.5 day | S01–S04 final behavior | Engineer + maintainer |

### S01 — Package identity, ownership and release baseline

**Problem:** the public npm package cannot currently offer publicly accessible source, a complete license or a tested Node support statement. Its source release also lives on an unmerged draft branch.

**Suggested approach:**

- Reconcile PR #1 and the default branch through the normal review/merge process before starting release work. Preserve the published tag and its commit. Do not rewrite release history.
- Propose MIT to align with spec's existing declaration, subject to the rights holder confirming the license and copyright attribution. Include the complete license in both packed packages.
- Populate metadata for both packages using the actual repository and package directories, not the illustrative `github.com/tulipesjs/core` URL in the proposal. Verify issue and homepage links anonymously after source publication.
- Prepare SECURITY.md, CONTRIBUTING.md and maintainer information. Name a working private disclosure channel; do not invent an email address or promise an unsupported response SLA.
- Propose Node 24.x as the first supported runtime line, initially `engines.node: ">=24.0.0 <25"`. Test the minimum declared version and the latest 24.x release. Treat Node 22/26 support as an explicit later compatibility expansion, not an inferred guarantee from `>=20.11`.

Node 20 is EOL; Node 22 and 24 are LTS in the current release table. The narrow Node 24 proposal follows the framework's existing CI baseline and limits the initial support commitment. [Node.js release status](https://nodejs.org/en/about/previous-releases).

**Acceptance criteria:**

- Both tarballs contain the approved license and accurate metadata; incompatible Node versions are outside the declared engine range.
- The default branch contains the released work and is the source for the sprint branch.
- Published repository, issue, contribution and security links are usable without maintainer access.
- Maintainer ownership and the tested runtime/OS scope are documented; Linux CI is required, with a macOS CLI smoke check. Do not claim Windows support without testing it.

**Relevant code:** package manifests, repository-level policy files, [core migration guide](../../packages/core/MIGRATING.md), and GitHub repository settings.

**Dependency:** changing repository visibility and selecting a license require maintainer decisions. If these are withheld, preparation can finish but public governance and provenance acceptance remain incomplete.

### S02 — Test and publish the exact artifact

**Problem:** workspace imports can conceal missing files, incorrect exports or undeclared dependencies. The tag-triggered publishing workflow typechecks and builds but can publish without running behavioral tests. Manual tarball validation from the previous sprint is not a permanent release gate.

**Suggested approach:**

- Reuse the existing tests and Mongo/Redis CI services. Run them against each declared Node support target; fail the integration job if its test URLs are absent or integration cases are skipped.
- Pack core and spec once using Yarn so `publishConfig` transforms are preserved. Record their digests and versions. Install those archives outside the monorepo, without workspace symlinks or accidental resolution of the published stable version.
- Drive the compiled CLI to generate and install applications. Exercise both presets once S03 lands. Verify imports, exports, CLI version, generated types, environment check, tests, startup, request responses, shutdown and spec generation.
- Pass the verified archives to the publish job and check their digests there. Publish those files with an explicit dist-tag; do not rebuild/repack the workspace during publication.
- Make both tag and manual dispatch paths require the same validation. Require the release commit to come from reviewed default-branch history; reject version/tag mismatches. Define recovery when one package publishes and the second fails without overwriting immutable versions.
- Add coverage reporting for the existing suite. Establish a measured baseline for boot, ACL and environment branches, then prevent regression in those areas. Use behavior-based assertions rather than an arbitrary whole-repository percentage.
- Audit core/spec runtime dependencies and both generated dependency inventories separately. Fail on new high/critical findings; an existing exception must identify applicability, an owner, mitigation and expiry. An exception does not satisfy the later zero-high/critical production-readiness milestone.
- Configure npm trusted publishers for both packages, with GitHub-hosted runners and `id-token: write`. Keep Yarn for installation and packing; use a supported npm CLI to publish the archives with OIDC. Validate that a release candidate receives provenance before completing this item.

Trusted publishing currently requires npm 11.5.1+ and Node 22.14.0+, and the npm trust configuration must match the publishing workflow. Provenance is not generated for private repositories. Public source is therefore a prerequisite for the provenance acceptance criterion, independent of tokenless authentication. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/).

**Acceptance criteria:**

- A deliberately missing packed file or an undeclared dependency fails the isolated install/smoke job.
- The full existing 59-test baseline remains green; changed behavior gains its own Vitest regressions. Type contracts and production builds pass.
- Minimal app checks run in a job without Mongo/Redis services. Production preset checks use dedicated services and isolated data.
- Archive digests connect the tested artifacts to the published versions. A failed required check prevents publication through either workflow trigger.
- A candidate is published under `next`, leaving `latest` unchanged. Its provenance identifies the expected source commit and workflow.

**Relevant code:** [CI](../../.github/workflows/ci.yml), [publishing](../../.github/workflows/publish.yml), [CLI tests](../../packages/core/tests/cli.test.ts), package manifests and new release-smoke scripts.

### S03 — Minimal first run and explicit production preset

**Problem:** the starter requires MongoDB and Redis, generates a large operational surface, and does not provide its own `test` script. The CLI currently has no preset parsing; adding a documented flag alone would not implement a preset.

**Suggested approach:**

- For the proposed next minor release, make `tulipes init my-api` and `tulipes init my-api --minimal` select the minimal preset. Support the canonical `--preset minimal` and `--preset production` forms. Reject unknown flags, missing values and conflicting preset selections before writing files.
- Minimal includes the entrypoint, environment declarations, sys core/security modules, a public health endpoint and one hello module, basic HTTP security middleware, Vitest tests and optional spec development tooling. Use `/health` and `/api/v1/hello` consistently in output and documentation.
- Omit database/Redis declarations, model plugins, auth/users/settings, workers, socket registrations, PM2 and nginx from minimal output. Build minimal core/security modules explicitly; deleting feature directories from the full scaffold is insufficient because its core imports Mongoose plugins and cache helpers.
- Keep the existing starter as `--preset production`, updating the reference application and parity checks together. The preset name describes bundled deployment examples; it is not a production certification.
- Make fresh projects expose `sync`, `check`, `typecheck`, `test` and `spec` scripts with documented behavior. Keep scripts and test dependencies compatible with the Node support policy.
- Defer per-feature flag combinations such as `--database`, `--queues` and `--auth`. Two complete presets give a manageable compatibility matrix first.

**Acceptance criteria:**

- From a fresh packed install, `init → install → sync → typecheck → check → test → start` succeeds without MongoDB, Redis or credentials for either. Health and hello return valid envelopes through declared RAI permissions.
- Minimal spec generation succeeds without infrastructure using its infrastructure-free declarations and the existing inspection path. This does not imply offline inspection works for production applications.
- Missing/invalid flags fail before any target directory content is created; the existing non-empty-directory safeguard remains tested.
- The production preset still boots backend and worker, generates specs with its services available, and retains its existing behavior.
- Measure time to first successful response on a documented runner and network/cache setup, aiming below two minutes after prerequisite tools are installed. Report cold installation time separately.

**Relevant code:** [CLI parser](../../packages/core/src/cli/main.ts), [init renderer](../../packages/core/src/cli/init.ts), [reference core config](../../example/modules/core/module.config.ts), [core env contract](../../example/modules/core/meta.variables.json), generated project scripts and CLI tests.

**Limit:** this removes runtime infrastructure requirements and direct starter dependencies. Core's transitive infrastructure packages remain installed until modularization; this sprint does not claim an Express-only dependency tree.

### S04 — Production credential guard and auth regression tests

**Problem:** the production template handles credentials and sessions, but its secret type currently validates strings rather than deployment policy. Existing manual authentication checks do not prove concurrent refresh rotation or production error redaction in CI.

**Suggested approach:**

- Add the production/staging credential policy in the auth module's configuration validation, mirrored in the scaffold. Reject known development signing keys and seed credentials, empty/whitespace secrets, and identical access/refresh signing keys. Report variable names and remediation without revealing values. Keep the minimal preset free of auth requirements.
- Turn refresh replay and revocation checks into retained HTTP integration tests. Send simultaneous refresh requests with the same token and verify exactly one succeeds; verify logout revokes subsequent access and refresh. Establish the expected password-change invalidation behavior for the subsequent security review.
- Assert that production 500 responses contain neither stack traces nor internal error messages. Use disposable credentials and capture logs to verify the new validation errors do not expose them.
- Triage the dated audit findings; apply compatible fixes with regressions where available. Do not force a PM2 major upgrade without inspecting its separately installed deployment graph and exercising supervision/restart behavior.
- Record the remaining auth/settings threat-model questions as security backlog, including proxy-aware rate limiting, audit durability, secret reveal, file/log paths and process restart controls.

**Acceptance criteria:**

- Production/staging rejects the known unsafe credentials before serving traffic, with redacted diagnostics; disposable valid credentials boot normally.
- Concurrent rotation, logout invalidation and production error handling have deterministic automated assertions against the generated app.
- Audit findings are classified by affected package/preset and applicability. Findings requiring larger remediation block the affected release when warranted; they are not dismissed to meet the sprint date.

**Relevant code:** [auth config](../../example/modules/auth/module.config.ts), [token helpers](../../example/modules/auth/helpers/tokens.ts), [auth controllers](../../example/modules/auth/controllers/auth.controllers.ts), [error handler](../../packages/core/src/http/error-handler.ts), the corresponding scaffold templates and packed-app tests.

### S05 — Executable documentation and release policy

**Problem:** the public quick start, printed URLs and generated scripts disagree. Users also need to distinguish framework guarantees from starter policy and to know how long a release is supported.

**Suggested approach:** correct the hello URL; add a minimal tutorial checked by S02/S03; document every CLI command's infrastructure requirements; explain the two presets, trusted middleware, inspection limits and package versus application ownership. Add a CI badge once results are publicly accessible.

Define public contracts using documented exports; mark implementation-only escape hatches clearly. Propose normal fixes on the current minor and critical security backports to the previous minor, subject to named maintainer capacity and a published support window. Preserve the existing pre-1.0 migration policy and document RC usage and release recovery.

**Acceptance criteria:** every quick-start command is exercised in CI; printed endpoint URLs resolve in the generated preset; support and migration policy names concrete maintained lines and responsibilities. No production-readiness claim is made from test count alone.

**Relevant code:** core/spec README files, generated README/help, [testing guide](../testing.md), changelog/migration guide, and the release workflow.

## 3. Order, tradeoffs and sprint exit

| Working days | Planned result |
|---|---|
| 1 | Resolve maintainer decisions, reconcile the released source, and prepare S01. |
| 2–4 | Establish S02 artifact verification and required release checks; retain existing production-starter behavior as the baseline. |
| 5–6 | Implement S03 with tests per behavior; extend the artifact job to both presets. |
| 7–8 | Finish preset verification, S04 abuse cases and S05 documentation. |
| 9–10 | Review, repair CI/platform issues, and verify an RC only if its prerequisites are met. |

Proposed target: `0.9.0-rc.1` under npm's `next` dist-tag, because changing the default starter and declaring engine support changes expectations. Final versions and publication are separate release decisions. A candidate and stable package each have their own verified artifact; changing the manifest for stable requires packing and testing that new artifact.

The sprint exits with a clean-machine demo of both presets, green tests/typechecks, archived package verification and coverage/audit reports, migration instructions, and explicit status for every governance prerequisite. Public provenance is marked blocked if public source or npm configuration is unresolved; a private passing build is not substituted for it.

If capacity slips, preserve release integrity and credential safeguards first. Ship an explicitly selected minimal preset as a preview and defer changing the default, with corresponding version/release notes, rather than silently reducing acceptance criteria. Drop optional platform expansion and design spikes before cutting required regression tests.

## 4. Subsequent sprints: offline inspection and modularization

These workstreams remain priorities, but both change the module interface and need a migration plan. Do not commit all nine proposed packages to Sprint 01.

| Follow-up | Proposed scope | Exit evidence | Planning range |
|---|---|---|---|
| Sprint 02 | Declarative route/spec inspection and focused auth/settings security review | A migrated production starter generates deterministic specs without service connections or production secrets; runtime route/schema parity; retained security abuse cases | 10–15 engineering days, re-estimate after design |
| Sprint 03 | First infrastructure extraction, then queues/sockets as proven adapters | Core installs/boots without the extracted provider; aggregate boot errors, capabilities and cleanup remain correct; upgrade fixture passes | First extraction 5–8 days; remaining adapters estimated from it |
| Later milestone | CLI/i18n packaging decisions, feature composition, support policy and production pilot | Measured installation reduction, deployment/load/security evidence, documented compatibility and rollback | Estimate after the first adapter and pilot scope |

**Offline design constraints:**

- Reusing today's config and route factories is not sufficient: imports can have side effects, config loads Mongoose plugins, and factories receive live capabilities. Separate declaration loading from acquisition of runtime resources through a small shared interface.
- Validate environment declaration structure and values actually needed to select declarations without requiring unrelated runtime secrets. Keep runtime environment validation strict. Avoid dummy production credentials or placeholder models/queues to make inspection appear successful.
- Define model metadata separately from connected models if it is needed for documentation. Preserve ACL and RAI validation and use the same declarations for runtime mounting and generated specs.
- Offline tooling must skip application bootstrap, queue registration/consumption, socket setup, readiness and shutdown hooks. Tool-owned cleanup remains responsible for any resources the tool itself acquires.
- Initially make offline behavior explicit for compatible modules, with actionable errors for legacy factories that require infrastructure and an explicit infrastructure-backed path. Decide the default only after the production starter migrates.
- Tests should run with service connections denied, assert lifecycle tasks were not invoked, compare normalized runtime/offline route/schema records, and verify repeated output is deterministic for identical declarations/configuration.
- The guarantee is that the framework's supported declaration pipeline acquires no application infrastructure or writes application data. Importing arbitrary JavaScript is not a sandbox; do not promise that arbitrary module code cannot cause side effects.

**Adapter design constraints:** use the existing boot driver, BootReport and cleanup ownership. Keep infrastructure types out of core's public context; adapters contribute checked capabilities. Start with Mongoose because both runtime acquisition and model metadata already exist to distinguish. Preserve omitted-infrastructure behavior as another real mode; do not introduce a generic plugin bus before demonstrating the required variation.

Extract one adapter with compatibility tests before duplicating its pattern. Decide whether i18n's always-available translator is a useful core contract before making it optional. Treat `@tulipes/auth` and `@tulipes/settings` as packaging proposals: converting editable application policy into libraries changes ownership and should not happen merely to complete a package list.

The full security follow-up must cover concurrent refresh/revocation and password-change timing, secret-access audits including sink failure and log-level filtering, proxy/IP trust and rate limits, log/file path constraints, bounded streaming, PM2 target scoping, and cookie/CSRF guidance for applications that adopt cookie authentication. PM2 currently uses its JavaScript API here; review actual calls and authorization rather than assuming a shell-injection flaw.

## 5. Maintainer decisions and remaining uncertainty

| Decision | Proposed direction | Why it matters |
|---|---|---|
| License and attribution | MIT, consistent with spec, after rights-holder confirmation | Needed before writing the authoritative license or claiming public legal usability. |
| Source visibility | Publish reviewed source and history in the existing repository, or choose a separate public repository | Existing history and release references need review before exposure; determines metadata, issue access and provenance configuration. No visibility change is part of this planning task. |
| Maintainers and disclosure | Name the release owner, reviewer and private report channel | Contribution/security policies need contacts and response commitments that actually exist. |
| Runtime coverage | Node 24.x first; expand only after compatibility checks | Avoids promising all future Node versions or adopting the proposal's EOL Node 20 baseline. |
| Default preset | Minimal in the next minor; production selected explicitly | Changes onboarding; requires CLI migration notes and tests. |
| Support capacity | Current-minor maintenance; previous-minor critical security fixes with a defined window | Backports create ongoing work beyond this sprint. |
| npm trust | Configure each package for the exact public repository/workflow | Workflow code alone cannot establish the npm-side trust relationship. |

At the original planning baseline no implementation PR, repository visibility change, package split or release had been performed. See the implementation status above for subsequent authorized work. The original 22–36-day program estimate should be revisited after the offline declaration design and first adapter: some proposed work is already delivered, while backwards compatibility and independent security review remain uncertain.
