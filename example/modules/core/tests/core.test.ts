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

test("publicDomain takes a hostname and nothing that would be a path or an nginx directive", async () => {
  const { default: coreConfig } = await import("../module.config.ts");
  const domain = (coreConfig as unknown as { schema: { shape: { publicDomain: { safeParse(v: unknown): { success: boolean } } } } }).schema.shape.publicDomain;
  for (const ok of ["localhost", "api.example.com", "A-1.example.co.uk"]) expect(domain.safeParse(ok).success, ok).toBe(true);
  for (const bad of ["../x", "a.example/../../cron.d/x", "a;b", "a.example { return 200; }", "a\nb", "-a.example", "a..b", ""]) {
    expect(domain.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  }
});
