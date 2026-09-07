# Tulipes reliability proposal

Status: implementation added on this branch; see `docs/testing.md` for validation.

Tulipes centralizes application wiring through module conventions and boot-time
validation. Some guarantees currently have gaps: failed startup can leave resources
open, route scanning does not prove authorization executes, and documentation
generation can run database bootstrap tasks.

This plan covers five improvements using the existing architecture: explicit
boot phases, module-owned behavior, aggregate diagnostics, and shared route
declarations. The implementation retains these module conventions and adds regression coverage.

## 1. Lifecycle reliability

**Problem:** Boot failures after infrastructure initialization do not consistently
release acquired resources. During shutdown, application hooks run before requests
and jobs drain, so hooks such as the example's cache cleanup can remove resources
while active work still needs them. A resource-close failure can also prevent
subsequent cleanup.

**Suggested approach:**

- Register cleanup immediately when a resource is acquired, including during
  partially completed boot phases.
- Wrap startup in a shared failure-cleanup path that preserves the original error
  and reports cleanup failures separately.
- Stop accepting requests and consuming new jobs, drain active work, then run
  module cleanup hooks in reverse dependency order.
- Keep producer connections and database access available until dependent work
  and hooks finish.
- Make shutdown idempotent, attempt every cleanup step, and define a bounded
  shutdown timeout.
- Document changes to lifecycle-hook timing in the migration guide.

**Acceptance criteria:**

- [x] Failures during database registration, queue setup, route loading, socket
  setup, and readiness leave no acquired resources running.
- [x] In-flight requests and jobs retain required resources while draining.
- [x] Repeated shutdown calls share one cleanup operation.
- [x] One cleanup failure does not prevent the remaining cleanup attempts.

**Relevant code:** `packages/core/src/boot/boot.ts`,
`packages/core/src/db/database.ts`,
`packages/core/src/queues/queue-manager.ts`,
`example/modules/core/module.config.ts`.

## 2. Route enforcement

**Problem:** The scanner checks that a route contains `rai()`, but a handler
placed before it can respond without authorization. Response-producing middleware
falls outside the scan. The current checks therefore do not establish the full
documented guarantee.

**Suggested approach:**

- Require `rai()` to be the first handler on every supported endpoint registration.
- Validate individual HTTP-method handler chains, including chained route
  declarations.
- Continue reporting violations through `BootReport`, identifying the module,
  method, and path.
- Explicitly define middleware as trusted application code; document that
  arbitrary middleware can terminate a request.
- Reject unsupported registration patterns with actionable diagnostics wherever
  they can be detected.

**Acceptance criteria:**

- [x] Missing or incorrectly positioned `rai()` declarations abort boot.
- [x] Every supported method chain executes authorization before its endpoint
  handler.
- [x] Unknown roles and denied permissions retain the expected rejection behavior.
- [x] Documentation accurately describes what scanning verifies and its middleware
  boundary.

**Relevant code:** `packages/core/src/http/route-scan.ts`,
`packages/core/src/http/rai.ts`.

## 3. Documentation tooling and route accuracy

**Problem:** `tulipes spec` disables listening but still follows backend
initialization, including database connections and bootstrap tasks. Nested router
mount prefixes are omitted by the scanner, which can produce incorrect documented
URLs.

**Suggested approach:**

- Introduce a shared inspection path for `tulipes routes` and `tulipes spec` that
  skips bootstrap tasks, workers, listeners, and readiness hooks.
- Initially retain infrastructure initialization where existing route factories
  require it; document that limitation explicitly.
- Separate route declarations from resource acquisition incrementally, allowing
  inspection without live infrastructure. Module imports and factories can execute
  arbitrary code; do not describe inspection as universally side-effect-free.
- Capture mount paths explicitly through a supported registration mechanism
  instead of attempting to reconstruct compiled Express matchers.
- Report unsupported path patterns rather than silently generating incomplete URLs.
- Identify custom access-checker behavior as unknown in generated authorization
  metadata when static ACL grants cannot describe it.

**Acceptance criteria:**

- [x] Inspection never invokes framework bootstrap tasks or starts traffic consumers.
- [x] Inspection releases every resource it initializes.
- [x] Supported nested routers produce complete URLs in both output formats.
- [x] Unsupported paths and dynamic authorization policies produce clear diagnostics.

**Relevant code:** `packages/core/src/cli/spec.ts`,
`packages/core/src/cli/routes.ts`, `packages/core/src/boot/boot.ts`,
`packages/core/src/http/route-scan.ts`, `packages/spec/src/extract.ts`.

## 4. Behavioral verification

**Problem:** CI verifies compilation, CLI startup, generated types, and scaffold
consistency. These checks do not exercise the runtime guarantees above. No
automated behavioral test suite was found during source inspection.

**Suggested approach:**

- Add small fixture applications that exercise public framework behavior.
- Cover module ordering, aggregated environment errors, route enforcement,
  request validation, response envelopes, and lifecycle cleanup.
- Use isolated MongoDB and Redis services for tests that need real connection,
  queue, and drain behavior.
- Run these checks in CI alongside the existing scaffold and type checks.
- Add regression cases with each corresponding implementation change.

**Acceptance criteria:**

- [x] CI detects authorization bypasses and failed-boot resource leaks.
- [x] Validation tests verify both coerced handler inputs and client-facing error
  envelopes.
- [x] Lifecycle tests exercise failure paths and active work during shutdown.
- [x] Fixtures use isolated resources and clean up after failures.

**Relevant code:** `.github/workflows/ci.yml`, `packages/core/package.json`,
`packages/spec/package.json`.

## 5. Lifecycle-aware context types

**Problem:** A single `Ctx` exposes optional services across all boot phases.
Consumers rely on assertions such as `ctx.models!`, while TypeScript cannot
distinguish a configuration factory from a backend route factory.

**Suggested approach:**

- Introduce context types corresponding to existing phases and process modes.
- Expose early-phase services to configuration factories and backend-specific
  services to route factories.
- Preserve optionality for genuinely optional infrastructure: a backend context
  alone must not imply that a database exists.
- Provide checked accessors or capability narrowing for modules that require
  models or queues.
- Update public contracts, generated examples, and migration guidance together.

**Acceptance criteria:**

- [x] Configuration factories cannot access services unavailable during configuration.
- [x] Backend route factories receive a typed Express application.
- [x] Database-free applications remain valid.
- [x] Required infrastructure can be accessed without unchecked non-null assertions.
- [x] Compile-time fixtures demonstrate both accepted and rejected usage.

**Relevant code:** `packages/core/src/boot/contracts.ts`,
`packages/core/src/boot/boot.ts`, `packages/core/src/cli/sync.ts`,
`example/modules/hello/controllers/greetings.controllers.ts`.

## Delivery order

Establish the behavioral test harness first, then implement lifecycle cleanup,
route enforcement, inspection improvements, and context typing. Each change should
include its regression coverage and documentation updates. These can be delivered
as focused implementation PRs after agreement on this proposal.

## Validation status

Runtime fixes and Vitest regression tests now cover the acceptance criteria above.
CI runs real MongoDB and Redis integration checks and TypeScript contract fixtures.
Inspection deliberately retains infrastructure initialization when factories require
it; a completely offline declaration pipeline remains a later design step.
Shutdown bounds waiting but cannot cancel arbitrary application JavaScript; see
`packages/core/MIGRATING.md` for the contract and migration steps.
