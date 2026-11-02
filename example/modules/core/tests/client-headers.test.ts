import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { useTestApp } from "@tulipes/testing";

import { CLIENT_HEADERS, readClientHeaders } from "../helpers/client-headers.ts";
import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function reader(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower[name.toLowerCase()];
}

test("valid headers are kept, normalized where the spec says so", () => {
  const { client, missing } = readClientHeaders(reader({
    "X-Platform": " Android ",
    "X-App-Version": "1.4.2+37",
    "X-App-Mode": "staging",
    "X-Device-Id": "b3c1f9a2-0d4e-4c8a-9f1e-2a7b5c6d8e90",
    "X-Request-Id": "req-12345678",
  }));

  expect(missing).toEqual([]);
  expect(client).toEqual({
    platform: "android",
    appVersion: "1.4.2+37",
    appMode: "staging",
    deviceId: "b3c1f9a2-0d4e-4c8a-9f1e-2a7b5c6d8e90",
    requestId: "req-12345678",
  });
});

test("invalid or missing values fall back to the defaults; the request id is generated", () => {
  const { client } = readClientHeaders(reader({
    "X-Platform": "windows",
    "X-App-Version": "latest",
    "X-App-Mode": "prod",
    "X-Device-Id": "short",
    "X-Request-Id": "bad id!",
  }));

  expect(client).toMatchObject({ platform: "web", appVersion: null, appMode: "production", deviceId: null });
  expect(client.requestId).toMatch(UUID);
});

test("only a required header that is absent is reported", () => {
  const specs = { ...CLIENT_HEADERS, platform: { ...CLIENT_HEADERS.platform, required: true } };

  expect(readClientHeaders(reader({}), specs).missing).toEqual(["x-platform"]);
  expect(readClientHeaders(reader({ "x-platform": "ios" }), specs).missing).toEqual([]);
  // Present but invalid is a fallback, not a refusal.
  expect(readClientHeaders(reader({ "x-platform": "windows" }), specs)).toMatchObject({ missing: [], client: { platform: "web" } });
});

test("the request id round-trips, or is generated, on every response", async () => {
  const echoed = await fetch(app.base + "/api/v1/hello", { headers: { "X-Request-Id": "req-12345678" } });
  expect(echoed.status).toBe(200);
  expect(echoed.headers.get("x-request-id")).toBe("req-12345678");

  const generated = await fetch(app.base + "/api/v1/hello", { headers: { "X-Request-Id": "bad id!" } });
  expect(generated.headers.get("x-request-id")).toMatch(UUID);

  const unrouted = await fetch(app.base + "/not-a-route");
  expect(unrouted.headers.get("x-request-id")).toMatch(UUID);
});

test("a preflight is answered by cors and exposes the request id to browsers", async () => {
  const preflight = await fetch(app.base + "/api/v1/hello", {
    method: "OPTIONS",
    headers: {
      origin: "https://console.example.test",
      "access-control-request-method": "GET",
      "access-control-request-headers": "x-platform, x-app-version, x-request-id",
    },
  });

  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-headers")).toBe("x-platform, x-app-version, x-request-id");

  const response = await fetch(app.base + "/api/v1/hello", { headers: { origin: "https://console.example.test" } });
  expect(response.headers.get("access-control-expose-headers")).toBe("X-Request-Id");
});
