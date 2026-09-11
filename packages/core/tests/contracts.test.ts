import { expect, test, vi } from "vitest";
import { Environment } from "../src/env/environment.js";
import { sortModules } from "../src/modules/graph.js";
import type { ModuleManifest } from "../src/modules/manifest.js";
import { BootReport } from "../src/errors/boot-error.js";
import { fixture } from "./fixture.js";

test("environment resolves and attributes deployment overrides while redacting secrets", async () => {
  const app = await fixture({
    "modules/probe/meta.variables.json": JSON.stringify({
      variables: [
        {
          name: "TEST_CONTRACT_NUMBER",
          type: "number",
          description: "number",
          default: 1,
        },
        {
          name: "TEST_CONTRACT_SECRET",
          type: "secret",
          description: "secret",
          required: true,
        },
      ],
    }),
    ".envs/.env.test":
      "TEST_CONTRACT_NUMBER=2\nTEST_CONTRACT_SECRET=fixture-only\n",
  });

  const file = Environment.load({ rootDir: app.rootDir, appEnv: "test" });

  expect(file.get("TEST_CONTRACT_NUMBER")).toBe(2);
  expect(file.store.sourceOf("TEST_CONTRACT_NUMBER")).toBe("file");

  vi.stubEnv("TEST_CONTRACT_NUMBER", "3");

  const injected = Environment.load({ rootDir: app.rootDir, appEnv: "test" });

  expect(injected.get("TEST_CONTRACT_NUMBER")).toBe(3);
  expect(injected.store.sourceOf("TEST_CONTRACT_NUMBER")).toBe("process.env");
  expect(file.store.snapshot().TEST_CONTRACT_SECRET).toBe("•••");
  expect(() => file.get("TEST_CONTRACT_TYPO")).toThrow(/never declared/);
});

test("environment aggregates all missing required values", async () => {
  const app = await fixture({
    "modules/probe/meta.variables.json": JSON.stringify({
      variables: [
        {
          name: "TEST_CONTRACT_A",
          type: "string",
          description: "a",
          required: true,
        },
        {
          name: "TEST_CONTRACT_B",
          type: "number",
          description: "b",
          required: true,
        },
      ],
    }),
  });

  expect(() =>
    Environment.load({ rootDir: app.rootDir, appEnv: "test" }),
  ).toThrow(/2 issue/);
});

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
