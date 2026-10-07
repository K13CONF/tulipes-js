import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot, type BootHandle } from "@tulipes/core/boot";
import { extract, toOpenApi, toPostman } from "@tulipes/spec";

let handle: BootHandle;
let base: string;

beforeAll(async () => {
  vi.stubEnv("PORT", "0");

  handle = await boot({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    appEnv: "test",
    handleSignals: false,
  });

  const address = handle.server?.address();

  if (!address || typeof address === "string")
    throw new Error("No HTTP listener");

  base = "http://127.0.0.1:" + address.port;
}, 15_000);

afterAll(async () => {
  await handle?.shutdown();

  vi.unstubAllEnvs();
});

test("hello responds through the declared public endpoint", async () => {
  const response = await fetch(base + "/api/v1/hello");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, errors: [] });
});

test("unknown endpoints return the error envelope", async () => {
  const response = await fetch(base + "/not-a-route");

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ success: false, data: null });
});

test("an inspection boot describes the same routes and schemas as the running app", async () => {
  const inspection = await boot({
    rootDir: fileURLToPath(new URL("../", import.meta.url)),
    mode: "backend",
    inspect: true,
    handleSignals: false,
  });

  try {
    const inspected = { ...extract(inspection.ctx), app: { name: "parity" } };
    const runtime = { ...extract(handle.ctx), app: { name: "parity" } };

    expect(await toOpenApi(inspected)).toEqual(await toOpenApi(runtime));
    expect(await toPostman(inspected)).toEqual(await toPostman(runtime));
  } finally {
    await inspection.shutdown();
  }
});

test("health needs no external infrastructure", async () => {
  expect(handle.ctx.models).toBeUndefined();
  expect(handle.ctx.queues).toBeUndefined();

  const response = await fetch(base + "/health");

  expect(await response.json()).toMatchObject({
    success: true,
    data: { status: "ok" },
  });
});
