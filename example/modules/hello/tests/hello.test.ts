import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot } from "@tulipes/core/boot";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });


test("hello responds through the declared public endpoint", async () => {
  const response = await fetch(app.base + "/api/v1/hello");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, errors: [] });
});
