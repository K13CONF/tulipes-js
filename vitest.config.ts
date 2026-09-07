import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 15_000,
    restoreMocks: true,
  },
});
