import { expect, test } from "vitest";
import { sortModules } from "../src/modules/graph.ts";
import type { ModuleManifest } from "../src/modules/manifest.ts";
import { BootReport } from "../src/errors/boot-error.ts";

const module = (
  name: string,
  tier: "sys" | "app",
  priority: number,
  dependsOn: string[] = [],
): ModuleManifest => ({
  name,
  packageName: name,
  dir: "/unused",
  tier,
  priority,
  dependsOn,
  requires: [],
  env: {},
});

test("dependencies outrank priority while sys modules precede app modules", () => {
  const report = new BootReport();

  const order = sortModules(
    [
      module("feature", "app", 0, ["core"]),
      module("core", "sys", 100),
      module("child", "app", -1, ["feature"]),
    ],
    report,
  );

  expect(order.map((m) => m.name)).toEqual(["core", "feature", "child"]);
  expect(report.issues).toEqual([]);
});

test.each([
  {
    modules: [module("a", "app", 0, ["b"]), module("b", "app", 0, ["a"])],
    error: /cycle/,
  },
  { modules: [module("a", "app", 0, ["missing"])], error: /no such module/ },
  {
    modules: [module("a", "sys", 0, ["b"]), module("b", "app", 0)],
    error: /sys module cannot depend/,
  },
])(
  "invalid module graphs produce actionable diagnostics",
  ({ modules, error }) => {
    const report = new BootReport();

    sortModules(modules, report);

    expect(() => report.throwIfAny("modules")).toThrow(error);
  },
);

test("a url variable accepts a replica set's host list and still rejects a malformed one", async () => {
  const { coerceValue } = await import("../src/env/coerce.ts");
  const spec = { key: "MONGO_URI", type: "url", description: "Database" } as const;
  const accepts = (value: string) => coerceValue(spec, value).ok;

  // Every self-hosted replica set is addressed this way; WHATWG URL parsing
  // rejects it outright, which used to make such a deployment unbootable.
  expect(accepts("mongodb://a:27017,b:27017,c:27017/db?replicaSet=rs0")).toBe(true);
  expect(accepts("mongodb://user:pw@a:27017,b:27017/db?replicaSet=rs0")).toBe(true);
  expect(accepts("mongodb://127.0.0.1:27017/db")).toBe(true);
  expect(accepts("mongodb+srv://cluster.example.net/db")).toBe(true);

  expect(accepts("mongodb://a:27017,not a host/db")).toBe(false);
  expect(accepts("mongodb://a:27017,/db")).toBe(false);
  expect(accepts("not a url")).toBe(false);
  expect(accepts("://a,b")).toBe(false);
});
