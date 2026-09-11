import express from "express";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { LogStreams } from "../../../example/modules/settings/helpers/log-stream.js";
import { errorHandler } from "../src/http/error-handler.js";

async function fixture(run: (get: (user?: string, query?: string) => Promise<Response>, dir: string) => Promise<void>, limits: ConstructorParameters<typeof LogStreams>[0] = {}, authorize: (signal: AbortSignal) => Promise<boolean> = async () => true) {
  const dir = mkdtempSync(join(tmpdir(), "tulipes-log-stream-"));
  const streams = new LogStreams({ durationMs: 3000, ...limits });
  const app = express();
  app.get("/", async (req, res) => {
    if (req.query.blocked) vi.spyOn(res, "write").mockReturnValue(false);
    await streams.open(res, { authorize, userId: String(req.query.user ?? "one"), expiresAt: Date.now() + Number(req.query.expires ?? 10000), dir,
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


test("authorization rejection and failure happen before SSE headers", async () => {
  for (const authorize of [
    async () => false,
    async () => { throw new Error("private authorization error"); },
  ]) {
    await fixture(async (get) => {
      const response = await get();
      expect([403, 503]).toContain(response.status);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.text()).not.toContain("private authorization error");
    }, {}, authorize);
  }
});

test("revoked authorization closes an idle stream and releases its slot", async () => {
  let allowed = true;

  await fixture(async (get) => {
    const response = await get();
    expect(response.status).toBe(200);
    allowed = false;

    const started = performance.now();
    expect(await response.text()).toContain("event: ready");
    expect(performance.now() - started).toBeLessThan(1000);

    allowed = true;
    const replacement = await get();
    expect(replacement.status).toBe(200);
    await replacement.body!.cancel();
  }, { connections: 1, authorizationIntervalMs: 50 }, async () => allowed);
});

test("a stalled recheck closes output but holds capacity until the query settles", async () => {
  let complete!: (allowed: boolean) => void;
  let checks = 0;
  let signal: AbortSignal | undefined;

  await fixture(async (get) => {
    const response = await get();
    const started = performance.now();
    expect(await response.text()).toContain("event: ready");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(signal?.aborted).toBe(true);
    expect(checks).toBe(2);

    // The response ended, but reconnects must not accumulate ignored DB checks.
    expect((await get()).status).toBe(429);
    complete(true);

    await vi.waitFor(async () => {
      const replacement = await get();
      if (replacement.status === 200) await replacement.body!.cancel();
      expect(replacement.status).toBe(200);
    });
  }, {
    connections: 1,
    authorizationIntervalMs: 50,
    authorizationTimeoutMs: 100,
  }, async (pendingSignal) => {
    checks++;
    if (checks !== 2) return true;

    signal = pendingSignal;
    return new Promise<boolean>((resolve) => { complete = resolve; });
  });
});

test("a rejected background check cannot expose driver details or keep streaming", async () => {
  let checks = 0;

  await fixture(async (get) => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain("event: ready");
    expect(body).not.toContain("private background error");
    expect(checks).toBe(2);
  }, { authorizationIntervalMs: 50 }, async () => {
    if (++checks === 1) return true;
    throw new Error("private background error");
  });
});

test("an initial authorization timeout returns 503 and reserves pending capacity", async () => {
  let complete!: (allowed: boolean) => void;
  let checks = 0;

  await fixture(async (get) => {
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      errors: [{ code: "STREAM_AUTHORIZATION_UNAVAILABLE" }],
    });
    expect((await get()).status).toBe(429);
    expect(checks).toBe(1);
    complete(true);

    await vi.waitFor(async () => {
      const replacement = await get();
      if (replacement.status === 200) await replacement.body!.cancel();
      expect(replacement.status).toBe(200);
    });
  }, { connections: 1, authorizationTimeoutMs: 50 }, async () => {
    if (++checks === 1) return new Promise<boolean>((resolve) => { complete = resolve; });
    return true;
  });
});

test("disconnect during opening aborts authorization without admitting overlapping checks", async () => {
  const streams = new LogStreams({ connections: 1 });
  const res = new (await import("node:events")).EventEmitter();
  let complete!: (allowed: boolean) => void;
  let signal: AbortSignal | undefined;
  const options = {
    userId: "one", expiresAt: Date.now() + 10000, dir: "/unused",
    prefix: "app", process: "backend" as const, tail: 0,
    authorize: async (pendingSignal: AbortSignal) => {
      signal = pendingSignal;
      return new Promise<boolean>((resolve) => { complete = resolve; });
    },
  };
  const response = Object.assign(res, { headersSent: false, setHeader: vi.fn() });
  const pending = streams.open(response as unknown as import("express").Response, options);
  await vi.waitFor(() => expect(signal).toBeDefined());
  res.emit("close");
  await pending;
  expect(signal!.aborted).toBe(true);
  await expect(streams.open(response as unknown as import("express").Response, options)).rejects.toMatchObject({ status: 429 });
  complete(true);
});

test("a slow successful check cannot extend permission from its completion time", async () => {
  const { AccessLease } = await import("../../../example/modules/settings/helpers/access-lease.js");
  vi.useFakeTimers();
  let checks = 0;
  let complete!: (allowed: boolean) => void;
  const invalid = vi.fn();
  const lease = new AccessLease(async () => {
    if (++checks === 1) return true;
    return new Promise<boolean>((resolve) => { complete = resolve; });
  }, 100, 100, invalid);

  try {
    await lease.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(90);
    complete(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.valid).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(checks).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(lease.valid).toBe(false);
    expect(invalid).toHaveBeenCalledOnce();
  } finally {
    complete(true);
    await lease.close();
    vi.useRealTimers();
  }
});
