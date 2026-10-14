import { afterEach, expect, test, vi } from "vitest";

import { appCache, closeCache, openCache } from "../helpers/cache/index.ts";

afterEach(() => closeCache());

const withRedis = (redisUrl: string) => ({ config: { core: { redisUrl } } }) as never;

test("without redis the cache is in-process and openCache returns at once", async () => {
  const started = Date.now();
  await openCache({ config: { core: {} } } as never, 5000);
  expect(Date.now() - started).toBeLessThan(500);

  const cache = appCache({ config: { core: {} } } as never);
  let runs = 0;
  await cache.wrap("k", 60, async () => ++runs);
  await cache.wrap("k", 60, async () => ++runs);
  expect(runs).toBe(1);
});

test("an unreachable redis does not stop the boot: openCache gives up after the timeout and never throws", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const started = Date.now();

  // Nothing listens on port 1.
  await expect(openCache(withRedis("redis://127.0.0.1:1"), 300)).resolves.toBeUndefined();

  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  // The app still gets a cache; it misses, as during any outage.
  await expect(appCache(withRedis("redis://127.0.0.1:1")).get("k")).resolves.toBeNull();
  error.mockRestore();
});

test.skipIf(!process.env.TEST_REDIS_URL)("with redis, openCache returns once ready and the first wrap is read-through with no warning", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const ctx = withRedis(process.env.TEST_REDIS_URL!);

  await openCache(ctx);
  const cache = appCache(ctx);
  const key = `cache-test:${Date.now()}`;
  let runs = 0;
  await cache.wrap(key, 30, async () => ++runs);
  await cache.wrap(key, 30, async () => ++runs);
  await cache.del(key);

  expect(runs).toBe(1);
  expect([...error.mock.calls, ...warn.mock.calls].flat().join(" ")).not.toMatch(/\[cache\] redis/);
});
