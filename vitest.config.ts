import { defineConfig } from "vitest/config";

if (process.env.REQUIRE_INTEGRATION_TESTS === "1" && (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL)) {
  throw new Error("CI requires TEST_MONGO_URI and TEST_REDIS_URL; integration tests must not be skipped");
}

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 15_000,
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      thresholds: { statements: 77, branches: 62, functions: 82, lines: 79 },
      reporter: ["text", "json-summary", "lcov"],
      include: ["packages/core/src/boot/**/*.ts", "packages/core/src/acl/**/*.ts", "packages/core/src/env/**/*.ts"],
    },
  },
});
