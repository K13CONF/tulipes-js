import express from "express";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { LogStreams } from "../../../example/modules/settings/helpers/log-stream.js";
import { errorHandler } from "../src/http/error-handler.js";

async function fixture(run: (get: (user?: string, query?: string) => Promise<Response>, dir: string) => Promise<void>, limits: ConstructorParameters<typeof LogStreams>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tulipes-log-stream-"));
  const streams = new LogStreams({ durationMs: 3000, ...limits });
  const app = express();
  app.get("/", (req, res) => {
    if (req.query.blocked) vi.spyOn(res, "write").mockReturnValue(false);
    streams.open(res, { userId: String(req.query.user ?? "one"), expiresAt: Date.now() + Number(req.query.expires ?? 10000), dir,
      prefix: "app-backend", process: "backend", tail: 1000, ...(req.query.level ? { level: String(req.query.level) } : {}) });
  });
  app.use(errorHandler("test"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server");
  try {
    await run((user = "one", query = "") => fetch("http://127.0.0.1:" + address.port + "/?user=" + user + query), dir);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("per-user and total stream limits release slots on client disconnect", async () => fixture(async get => {
  const first = await get();
  expect(first.status).toBe(200);
  const own = await get();
  expect(own.status).toBe(429);
  expect(await own.json()).toMatchObject({ errors: [{ code: "TOO_MANY_LOG_STREAMS" }] });
  const second = await get("two");
  expect(second.status).toBe(200);
  expect((await get("three")).status).toBe(429);
  await first.body!.cancel();
  let replacement: Response | undefined;
  await vi.waitFor(async () => {
    const candidate = await get("three");
    if (candidate.status === 200) replacement = candidate;
    expect(candidate.status).toBe(200);
  });
  await second.body!.cancel();
  await replacement!.body!.cancel();
}, { connections: 2, perUser: 1 }));

test("duration and credential expiry close idle streams and release capacity", async () => fixture(async get => {
  const started = performance.now();
  const response = await get();
  expect(await response.text()).toContain("event: ready");
  expect(performance.now() - started).toBeLessThan(1000);
  const short = await get("one", "&expires=30");
  expect(short.status).toBe(200);
  expect(await short.text()).toContain("event: ready");
  expect((await get("one", "&expires=-1")).status).toBe(401);
}, { connections: 1, durationMs: 100 }));

test("output cap ends the stream and severity filtering excludes unknown-level lines", async () => fixture(async (get, dir) => {
  writeFileSync(join(dir, "app-backend.log"), 'raw message\n{"level":30,"msg":"hidden"}\n'
    + Array.from({ length: 100 }, () => JSON.stringify({ level: 50, msg: "visible" })).join("\n") + "\n");
  const response = await get("one", "&level=error");
  const body = await response.text();
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(400);
  expect(body).toContain("visible");
  expect(body).not.toContain("hidden");
  expect(body).not.toContain("raw message");
}, { outputBytes: 400 }));

test("backpressure destroys the response immediately and releases its slot", async () => fixture(async get => {
  await expect(get("one", "&blocked=1")).rejects.toThrow();
  const next = await get();
  expect(next.status).toBe(200);
  await next.body!.cancel();
}, { connections: 1 }));

test("a frame exceeding the buffer cap is refused before it is queued", async () => fixture(async (get, dir) => {
  writeFileSync(join(dir, "app-backend.log"), "x".repeat(1000) + "\n");
  const response = await get();
  await expect(response.text()).rejects.toThrow();
}, { bufferBytes: 200 }));

test("a healthy reader receives history larger than a socket buffer", async () => fixture(async (get, dir) => {
  writeFileSync(join(dir, "app-backend.log"), Array.from({ length: 100 }, (_, i) => JSON.stringify({ level: 30, msg: "x".repeat(1000), index: i })).join("\n") + "\n");
  const response = await get();
  const reader = response.body!.getReader();
  let text = "";
  try {
    while (!text.includes('"index":99')) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
    }
    expect(text).toContain('"index":99');
    expect(Buffer.byteLength(text)).toBeGreaterThan(64 * 1024);
  } finally { await reader.cancel(); }
}));
