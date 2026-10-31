import { defineConfig } from "vitest/config";

if (process.env.REQUIRE_INTEGRATION_TESTS === "1" && (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL)) {
  throw new Error("CI requires TEST_MONGO_URI and TEST_REDIS_URL; integration tests must not be skipped");
}

export default defineConfig({
  test: {
    // The agents harness and its model adapter run here too: they boot
    // nothing and need no service, so they belong in the unit lane.
    // So do the list-query grammar and its Mongoose stages: pure, no database.
    include: [
      "packages/*/tests/**/*.test.ts",
      "example/modules/agents/tests/harness.test.ts",
      "example/modules/agents/tests/anthropic-client.test.ts",
      "example/modules/core/tests/query.test.ts",
      "example/modules/core/tests/query.stages.test.ts",
    ],
    testTimeout: 10_000,
    hookTimeout: 15_000,
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 77,
        branches: 62,
        functions: 82,
        lines: 79,
        "example/modules/agents/helpers/harness/**/*.ts": { statements: 90, branches: 85, functions: 90, lines: 90 },
        // run.ts executes against MongoDB, so example/modules/users/tests covers it, not this lane.
        "example/modules/core/helpers/query/{grammar,policy}.ts": { statements: 90, branches: 85, functions: 90, lines: 90 },
        "example/modules/core/helpers/query/mongoose/stages.ts": { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
      reporter: ["text", "json-summary", "lcov"],
      include: ["packages/core/src/boot/**/*.ts", "packages/core/src/acl/**/*.ts", "packages/core/src/env/**/*.ts", "example/modules/agents/helpers/harness/**/*.ts", "example/modules/core/helpers/query/**/*.ts"],
    },
  },
});
