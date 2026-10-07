import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";
import { boot } from "@tulipes/core/boot";
import { extract, toOpenApi, toPostman } from "@tulipes/spec";
import { useTestApp } from "@tulipes/testing";

/**
 * Boots the app once for this file on a free port, with no services: the
 * minimal preset declares none. Module tests live in modules/<name>/tests/
 * and boot the same way.
 */
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const app = useTestApp({ rootDir }, { beforeAll, afterAll });

test("hello responds through the declared public endpoint", async () => {
  const response = await app.get<{ message: string }>(app.api("/hello"));

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ success: true, errors: [] });
  expect(response.data?.message).toBeTypeOf("string");
});

test("unknown endpoints return the error envelope", async () => {
  const response = await app.get("/not-a-route");

  expect(response.status).toBe(404);
  expect(response.body).toMatchObject({ success: false, data: null });
});

test("an inspection boot describes the same routes and schemas as the running app", async () => {
  const inspection = await boot({ rootDir, mode: "backend", inspect: true, handleSignals: false });

  try {
    const inspected = { ...extract(inspection.ctx), app: { name: "parity" } };
    const runtime = { ...extract(app.ctx), app: { name: "parity" } };

    expect(await toOpenApi(inspected)).toEqual(await toOpenApi(runtime));
    expect(await toPostman(inspected)).toEqual(await toPostman(runtime));
  } finally {
    await inspection.shutdown();
  }
});

test("health needs no external infrastructure", async () => {
  expect(app.ctx.models).toBeUndefined();
  expect(app.ctx.queues).toBeUndefined();

  const response = await app.get<{ status: string }>("/health");

  expect(response.data).toEqual({ status: "ok" });
});
