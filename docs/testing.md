# Testing Tulipes

Run the fast suite with Node 24 and the repository's pinned Yarn:

```sh
yarn install --immutable
yarn test
yarn test:types
```

`yarn test:watch` runs Vitest in watch mode. Tests live under `packages/*/tests/`;
production builds include only `src/`. The compiler checks test code and
`context.test-d.ts` with `@ts-expect-error` assertions for invalid phase access.

Keep test code readable: expand long calls, objects and cleanup blocks over
multiple lines, and separate setup, actions, assertions and cleanup with blank
lines. Keep short related declarations or assertions together. Preserve comments
that explain ordering, races and resource ownership. Apply the same formatting to
reference tests and the starter test templates; literal fixture contents should
only change when the test scenario itself requires it.

Database and queue integration tests are skipped unless their respective test
URLs are supplied. Use dedicated local services and a test-only Redis database:

```sh
TEST_MONGO_URI=mongodb://127.0.0.1:27017/tulipes_tests \
TEST_REDIS_URL=redis://127.0.0.1:6379/3 yarn test
```

CI provides both services and runs the whole suite. Do not point these URLs at
application data. Tests override ambient `MONGO_URI`, `REDIS_URL`, and `PORT`
so an inherited application environment cannot redirect their connections.
Fixture directories use temporary storage; queue names are
unique per test and the worker test removes its own queue. Tests close resources
in cleanup paths, including when an assertion fails.

Coverage is behavioral: public boot/shutdown, mounted HTTP routes, environment and
module contracts, CLI code generation, spec extraction/output, and real MongoDB,
Redis and Socket.IO connections. New fixes should start with a failing regression
at one of these boundaries, followed by the smallest implementation that passes it.
Prefer unit tests for isolated behavior and integration tests when the failure
depends on resource ownership or the request execution chain.

Authorization regressions include async decisions, invalid decision types, and
guest state shared across requests. Generated-app checks exercise both the auth
helper and Passport middleware before RAI. Route tests cover duplicate URL
templates, and database tests simulate a driver that never settles forced cleanup.

The CI scaffold check compares generated modules with the reference example.
When changing a generated contract, update both `cli/init.ts` (and `new-module.ts`
where applicable) and the example module. Keep existing agent guides in sync if
changing their instructions.

## Coverage and packed installations

Run `REQUIRE_INTEGRATION_TESTS=1 yarn test:coverage` with both TEST URLs set.
Missing URLs fail CI immediately. Coverage is restricted to boot, ACL and env:
the measured sprint baseline is 77% statements, 62% branches, 82% functions and
79% lines (rounded down into enforced floors). These are regression floors,
not completion targets; uncovered error paths remain work for later tests.

```sh
node scripts/artifacts.mjs prepare .artifacts
node scripts/scaffold-smoke.mjs .artifacts minimal
# With TEST_MONGO_URI and TEST_REDIS_URL set:
node scripts/scaffold-smoke.mjs .artifacts production
```

Each smoke test installs the exact packed core and spec outside the monorepo,
uses the installed compiled CLI, then installs and audits a fresh app. It runs
the tutorial sync/typecheck/check/test/spec steps and boots the actual app.
Production also tests worker shutdown, redacted 500s and PM2 start/restart in a
dedicated PM2_HOME. Logs and dependency reports live in ignored `reports/`.
Temporary directories and process handles are cleaned up after checks.

The production starter's own suite exercises concurrent refresh and logout via
HTTP. Duplicate concurrent refreshes have one winner, but the replay expires
that device family, so the winning pair must also fail subsequent authentication.
The suite retains multi-generation reuse, other-device isolation, invalid/expired
token rejection, a delayed response after revocation and write-acknowledgment
failures before and after commit. The reference tests match generated code. Use
test-only databases; application data must never be supplied to this suite.

## Offline inspection

`yarn test packages/core/tests/inspection.test.ts` exercises offline loading and
runtime route/schema parity. It includes the production starter with connections
denied and secrets absent. Its runtime HTTP assertions need local port access.
Both starter app suites retain the same parity assertion against a real boot.

```sh
node scripts/scaffold-smoke.mjs .artifacts production --offline-only
```

This installs and typechecks a packed production starter, then generates specs in
two independent processes with socket connections denied, invalid service URLs
and empty runtime secrets. It requires package-registry access for installation
and audit, but no application services. CI runs it in a separate service-free job.
