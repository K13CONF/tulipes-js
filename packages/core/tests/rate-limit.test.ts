import { randomBytes } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { setTimeout } from "node:timers/promises";
import express from "express";
import { Redis } from "ioredis";
import { expect, test, vi } from "vitest";
import { errorHandler } from "../src/http/error-handler.js";
import { createRateLimits, type RateLimitOptions } from "../../../example/modules/security/helpers/rate-limit.js";
import { trustedProxies } from "../../../example/modules/security/helpers/proxy.js";

const options = (): RateLimitOptions => ({
  redisUrl: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:1",
  namespace: "test-" + randomBytes(12).toString("hex"),
  windowMs: 60_000, authLimit: 2, sessionLimit: 20, settingsLimit: 2,
});

async function server(config: RateLimitOptions, trust = "127.0.0.1") {
  const limits = createRateLimits(config);
  const app = express();
  app.set("trust proxy", trustedProxies(trust));
  app.use("/auth", limits.auth);
  app.use("/settings", limits.settings);
  app.use(express.json());
  app.use((_req, res) => { res.sendStatus(204); });
  app.use(errorHandler("test"));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => listener.once("listening", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return {
    request: (path = "/auth/login", ip = "198.51.100.1", method = "POST") => fetch("http://127.0.0.1:" + address.port + path, {
      method, headers: { "X-Forwarded-For": ip },
    }),
    close: async () => {
      limits.close();
      await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    },
  };
}

const integration = test.skipIf(!process.env.TEST_REDIS_URL);

integration("independent backend instances share an atomic quota, including case and slash variants", async () => {
  const config = options();
  const first = await server(config);
  const second = await server(config);
  try {
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).request(i % 2 ? "/AUTH/LOGIN/" : "/auth/login")));
    expect(replies.filter(reply => reply.status === 204)).toHaveLength(2);
    expect(replies.filter(reply => reply.status === 429)).toHaveLength(10);
    expect(Number(replies.find(reply => reply.status === 429)!.headers.get("retry-after"))).toBeGreaterThan(0);
  } finally { await first.close(); await second.close(); }
});

integration("credential paths share a quota while refresh, settings and other clients have independent budgets", async () => {
  const app = await server(options());
  try {
    expect((await app.request("/auth/login")).status).toBe(204);
    expect((await app.request("/auth/register")).status).toBe(204);
    expect((await app.request("/auth/password")).status).toBe(429);
    expect((await app.request("/auth/refresh")).status).toBe(204);
    expect((await app.request("/settings/modules")).status).toBe(204);
    expect((await app.request("/auth/login", "198.51.100.2")).status).toBe(204);
  } finally { await app.close(); }
});

integration("all auth and settings methods consume their broad budgets", async () => {
  const app = await server({ ...options(), sessionLimit: 2 });
  try {
    expect((await app.request("/auth/refresh")).status).toBe(204);
    expect((await app.request("/auth/me", undefined, "GET")).status).toBe(204);
    expect((await app.request("/auth/logout")).status).toBe(429);
    expect((await app.request("/settings/variables/X", undefined, "PUT")).status).toBe(204);
    expect((await app.request("/settings/reboot")).status).toBe(204);
    expect((await app.request("/settings/logs/stream", undefined, "GET")).status).toBe(429);
    expect((await app.request("/hello", undefined, "GET")).status).toBe(204);
  } finally { await app.close(); }
});

integration.each([
  ["", "198.51.100.1", "203.0.113.2", "192.0.2.3"],
  ["127.0.0.1", "192.0.2.1, 198.51.100.1", "192.0.2.2, 198.51.100.1", "192.0.2.3, 198.51.100.1"],
  ["127.0.0.1", "2001:db8:1234:5600::1", "2001:0db8:1234:56ff::2", "2001:db8:1234:5678::3"],
  ["127.0.0.1", "198.51.100.1", "::ffff:198.51.100.1", "::ffff:c633:6401"],
  ["127.0.0.1", "invalid-a", "invalid-b", "invalid-c"],
])("client identity cannot rotate within its trusted quota: %j %s", async (trust, ...ips) => {
  const app = await server(options(), trust);
  try {
    const statuses = [];
    for (const ip of ips) statuses.push((await app.request("/auth/login", ip)).status);
    expect(statuses).toEqual([204, 204, 429]);
  } finally { await app.close(); }
});

integration("unrelated namespaces are isolated and counters expire without extending on rejection", async () => {
  const config = options();
  const first = await server(config);
  const other = await server({ ...config, namespace: config.namespace + "-other" });
  const redis = new Redis(config.redisUrl);
  try {
    expect((await first.request()).status).toBe(204);
    expect((await first.request()).status).toBe(204);
    expect((await first.request()).status).toBe(429);
    expect((await other.request()).status).toBe(204);
    const keys = await redis.keys("tulipes:rate:" + config.namespace + ":*");
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain("198.51.100.1");
      expect(await redis.pttl(key)).toBeGreaterThan(0);
    }
    for (const key of keys) await redis.pexpire(key, 1000);
    expect((await first.request()).status).toBe(429);
    for (const key of keys) {
      expect(await redis.pttl(key)).toBeLessThanOrEqual(1000);
      await redis.pexpire(key, 100);
    }
    await setTimeout(150);
    expect(await redis.exists(...keys)).toBe(0);
    expect((await first.request()).status).toBe(204);
  } finally { redis.disconnect(); await first.close(); await other.close(); }
});

integration("store errors fail closed with sanitized responses in development/test too", async () => {
  const app = await server(options());
  const spy = vi.spyOn(Redis.prototype, "eval").mockRejectedValue(new Error("redis://secret-user:secret-password@internal"));
  try {
    for (const path of ["/auth/login", "/auth/refresh", "/settings/reboot"]) {
      const response = await app.request(path);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ success: false, errors: [{ code: "RATE_LIMIT_UNAVAILABLE", message: "Request limits are unavailable; try again later" }] });
    }
    expect((await app.request("/hello")).status).toBe(204);
  } finally { spy.mockRestore(); await app.close(); }
});

test("an unresponsive Redis handshake is bounded and shutdown releases its socket", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const blackhole = createServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  blackhole.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => blackhole.once("listening", resolve));
  const address = blackhole.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  const app = await server({ ...options(), redisUrl: "redis://127.0.0.1:" + address.port });
  try {
    const started = performance.now();
    expect((await app.request()).status).toBe(503);
    expect(performance.now() - started).toBeLessThan(2500);
  } finally {
    await app.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => blackhole.close(() => resolve()));
  }
});

test.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])("invalid quota configuration fails before connecting: %s", value => {
  for (const field of ["windowMs", "authLimit", "sessionLimit", "settingsLimit"]) {
    expect(() => createRateLimits({ ...options(), [field]: value })).toThrow("positive integer");
  }
});

test.each(["", "bad key", "x".repeat(129)])("invalid counter namespace fails before connecting: %j", namespace => {
  expect(() => createRateLimits({ ...options(), namespace })).toThrow("RATE_LIMIT_NAMESPACE");
});


integration("a stalled established Redis connection fails closed within the command deadline", async () => {
  const target = new URL(process.env.TEST_REDIS_URL!);
  const upstreamAddress = { host: target.hostname, port: Number(target.port || 6379) };
  const sockets = new Set<import("node:net").Socket>();
  let forwarding = true;
  const proxy = createServer(socket => {
    const upstream = createConnection(upstreamAddress);
    for (const connection of [socket, upstream]) {
      sockets.add(connection);
      connection.on("close", () => sockets.delete(connection));
      connection.on("error", () => { socket.destroy(); upstream.destroy(); });
    }
    socket.on("data", data => { if (forwarding) upstream.write(data); });
    upstream.on("data", data => { if (forwarding) socket.write(data); });
  });
  proxy.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => proxy.once("listening", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  target.hostname = "127.0.0.1";
  target.port = String(address.port);
  const app = await server({ ...options(), redisUrl: target.href });
  try {
    expect((await app.request()).status).toBe(204);
    forwarding = false;
    const started = performance.now();
    const response = await app.request();
    expect(response.status).toBe(503);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(await response.json()).toMatchObject({ errors: [{ code: "RATE_LIMIT_UNAVAILABLE" }] });
  } finally {
    await app.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});
