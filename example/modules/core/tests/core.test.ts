import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot } from "@tulipes/core/boot";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });


test("unknown endpoints return the error envelope", async () => {
  const response = await fetch(app.base + "/not-a-route");

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ success: false, data: null });
});
