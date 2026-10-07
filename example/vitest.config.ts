import { defineConfig } from "vitest/config";

// Node strips types natively, so the app's own files import without a loader.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
