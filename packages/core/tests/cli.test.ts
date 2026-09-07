import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runNewModule } from "../src/cli/new-module.js";
import { runSync } from "../src/cli/sync.js";
import { fixture } from "./fixture.js";

test("a generated kebab-case module produces valid TypeScript configuration declarations", async () => {
  const app = await fixture({
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
  });
  await runNewModule(app.rootDir, "billing-history");
  await runSync(app.rootDir);
  const path = app.rootDir + "/types/config.d.ts";
  const result = spawnSync(resolve("node_modules/.bin/tsc"), [path, "--noEmit", "--skipLibCheck"], { encoding: "utf8" });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(await readFile(path, "utf8")).toContain('"billing-history"?');
});
