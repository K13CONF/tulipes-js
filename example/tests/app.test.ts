import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { boot } from "@tulipes/core/boot";
import { extract, toOpenApi, toPostman } from "@tulipes/spec";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "./support.ts";

/**
 * App-level: what belongs to no module. Each module's tests live beside
 * it, in modules/<name>/tests/, and boot the app the same way.
 */
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });

test("an inspection boot describes the same routes and schemas as the running app", async () => {
  const inspection = await boot({ rootDir, mode: "backend", inspect: true, handleSignals: false });

  try {
    const inspected = { ...extract(inspection.ctx), app: { name: "parity" } };
    const runtime = { ...extract(app.handle.ctx), app: { name: "parity" } };

    expect(await toOpenApi(inspected)).toEqual(await toOpenApi(runtime));
    expect(await toPostman(inspected)).toEqual(await toPostman(runtime));
  } finally {
    await inspection.shutdown();
  }
});
