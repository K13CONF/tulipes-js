import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { fixture } from "../../core/tests/fixture.js";

const cli = resolve("packages/cli/src/bin.ts");

test("config:check loads every namespace from the store and prints it; invalid stored values fail it", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({ greeting: z.string().min(1).default('Hello'), port: z.number().default(1).meta({ restart: true }) }) });
    `,
  });
  const run = () => spawnSync(process.execPath, ["--import", "tsx", cli, "config:check"], { cwd: app.rootDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, APP_ENV: "production", PORT: "0" } });

  const first = run();
  expect(first.status, first.stdout + first.stderr).toBe(0);
  expect(first.stdout).toContain("1 settings namespace(s) in file config/settings.production.json");
  expect(first.stdout).toContain("✔ probe  v1");
  expect(first.stdout).toContain('greeting = "Hello"');

  const file = app.rootDir + "/config/settings.production.json";
  const document = JSON.parse(await readFile(file, "utf8"));
  document.probe = { ...document.probe, values: { greeting: "", port: 1 }, version: 2 };
  await app.write("config/settings.production.json", JSON.stringify(document));

  const second = run();
  expect(second.status).toBe(1);
  expect(second.stderr).toContain('stored setting "probe.greeting"');
});
