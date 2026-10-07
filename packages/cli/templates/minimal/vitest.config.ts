import { defineConfig } from "vitest/config";

// Node strips types natively, so the app's own files import without a loader.
// Every file boots the app once (@tulipes/testing), so files run one after another.
export default defineConfig({ test: { include: ["tests/**/*.test.ts", "modules/*/tests/**/*.test.ts"], fileParallelism: false } });
