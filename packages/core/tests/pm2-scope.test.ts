import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi, beforeEach } from "vitest";
import { restart } from "../../../example/modules/settings/helpers/pm2.js";

const fake = vi.hoisted(() => ({
  connect: vi.fn(),
  list: vi.fn(),
  restart: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("pm2", () => ({ default: fake }));
const root = realpathSync(resolve("example"));
const processInfo = (pm_id: number, name: string, cwd: string = root) => ({
  pm_id,
  pid: 1000 + pm_id,
  name,
  pm2_env: { pm_cwd: cwd },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PM2_HOME", "/tmp/tulipes-scope-test");
  vi.stubEnv("pm_id", "1");
  fake.connect.mockImplementation((cb) => cb());
  fake.restart.mockImplementation((_id, cb) => cb());
  fake.list.mockImplementation((cb) =>
    cb(undefined, [
      processInfo(1, "api"),
      processInfo(2, "worker"),
      processInfo(10, "api", resolve("packages/core")),
      processInfo(11, "unrelated", resolve("packages/spec")),
    ]),
  );
});

test("empty targets restart only the current app, by numeric ID, with self last", async () => {
  const result = await restart([]);
  expect(result).toEqual({ supervised: true, restarted: ["worker", "api"] });
  expect(fake.restart.mock.calls.map((call) => call[0])).toEqual([2, 1]);
  expect(fake.disconnect).toHaveBeenCalledOnce();
});

test.each([
  ["unrelated"],
  ["worker", "unrelated"],
  ["all"],
  ["2"],
  ["missing"],
])(
  "rejects the entire target set before any restart: %j",
  async (...targets) => {
    await expect(restart(targets)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_RESTART_TARGETS",
    });
    expect(fake.restart).not.toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalledOnce();
  },
);

test("an explicit name never restarts the same name in a different app", async () => {
  const result = await restart(["api", "api"]);
  expect(result.restarted).toEqual(["api"]);
  expect(fake.restart.mock.calls.map((call) => call[0])).toEqual([1]);
});

test("cluster members in the same application are each restarted once", async () => {
  fake.list.mockImplementation((cb) =>
    cb(undefined, [
      processInfo(1, "api"),
      processInfo(2, "api"),
      processInfo(3, "api", resolve("packages/core")),
    ]),
  );
  expect((await restart(["api"])).restarted).toEqual(["api"]);
  expect(fake.restart.mock.calls.map((call) => call[0])).toEqual([2, 1]);
});

test("missing or invalid process scope cannot authorize a restart", async () => {
  fake.list.mockImplementation((cb) =>
    cb(undefined, [
      { pm_id: 1, name: "no-cwd" },
      processInfo(2, "sibling", root + "-other"),
      { name: "no-id", pm2_env: { pm_cwd: root } },
      processInfo(-1, "negative"),
    ]),
  );
  await expect(restart([])).rejects.toMatchObject({
    status: 503,
    code: "NO_APP_PROCESSES",
  });
  expect(fake.restart).not.toHaveBeenCalled();
});

test("list and restart errors still disconnect from PM2", async () => {
  fake.list.mockImplementationOnce((cb) => cb(new Error("list failed")));
  await expect(restart([])).rejects.toMatchObject({
    code: "RESTART_UNAVAILABLE",
  });
  expect(fake.disconnect).toHaveBeenCalledOnce();
  fake.restart.mockImplementationOnce((_id, cb) =>
    cb(new Error("restart failed")),
  );
  await expect(restart(["worker"])).rejects.toMatchObject({
    code: "RESTART_UNAVAILABLE",
  });
  expect(fake.disconnect).toHaveBeenCalledTimes(2);
});

test("a failed connection is disconnected, and unsupervised use never connects", async () => {
  fake.connect.mockImplementationOnce((cb) => cb(new Error("connect failed")));
  await expect(restart([])).rejects.toMatchObject({
    code: "RESTART_UNAVAILABLE",
  });
  expect(fake.disconnect).toHaveBeenCalledOnce();
  vi.stubEnv("PM2_HOME", undefined);
  vi.stubEnv("pm_id", undefined);
  expect((await restart([])).supervised).toBe(false);
  expect(fake.connect).toHaveBeenCalledOnce();
});

test("an owned stopped process remains eligible for an explicit restart", async () => {
  fake.list.mockImplementation((callback) =>
    callback(undefined, [{ ...processInfo(2, "worker"), pid: 0 }]),
  );

  expect((await restart(["worker"])).restarted).toEqual(["worker"]);
  expect(fake.restart).toHaveBeenCalledWith(2, expect.any(Function));
});
