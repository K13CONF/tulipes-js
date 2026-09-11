import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { fixture } from "./fixture.js";

const cli = resolve("packages/core/src/cli/bin.ts");

function init(rootDir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cli, "init", ...args],
    {
      cwd: rootDir,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

test.each([
  ["api", "--unknown"],
  ["api", "--preset"],
  ["api", "--preset", "wrong"],
  ["api", "--minimal", "--preset", "production"],
  ["api", "extra"],
])(
  "rejects invalid init arguments before writing files: %j",
  async (...args) => {
    const app = await fixture();
    const result = init(app.rootDir, args);

    expect(result.status, result.stdout + result.stderr).toBe(2);

    await expect(access(app.rootDir + "/api")).rejects.toThrow();
  },
);

test("the default preset declares no infrastructure and supplies runnable test/spec commands", async () => {
  const app = await fixture();
  const result = init(app.rootDir, ["api"]);

  expect(result.status, result.stdout + result.stderr).toBe(0);

  const pkg = JSON.parse(
    await readFile(app.rootDir + "/api/package.json", "utf8"),
  );

  expect(pkg.scripts.test).toBe("vitest run");
  expect(pkg.scripts.spec).toContain("tulipes spec");
  expect(result.stdout).toContain("/api/v1/hello");

  await app.write(
    "api/verify.ts",
    `
    import assert from 'node:assert/strict';
    import { boot } from '@tulipes/core/boot';
    const handle = await boot({ rootDir: import.meta.dirname, appEnv: 'test', handleSignals: false });
    try {
      assert.equal(handle.ctx.models, undefined);
      assert.equal(handle.ctx.queues, undefined);
      const base = 'http://127.0.0.1:' + handle.server.address().port;
      for (const path of ['/health', '/api/v1/hello']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal((await response.json()).success, true);
      }
    } finally { await handle.shutdown(); }
  `,
  );

  const check = spawnSync(
    process.execPath,
    ["--import", "tsx", app.rootDir + "/api/verify.ts"],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PORT: "0", MONGO_URI: "", REDIS_URL: "" },
    },
  );

  expect(check.status, check.stdout + check.stderr).toBe(0);
});

test.each([
  ["--minimal", "api"],
  ["--preset", "minimal", "api"],
  ["api", "--preset", "production"],
])(
  "supports explicit presets and flags before the target: %j",
  async (...args) => {
    const app = await fixture();
    const result = init(app.rootDir, args);

    expect(result.status, result.stdout + result.stderr).toBe(0);

    const pkg = JSON.parse(
      await readFile(app.rootDir + "/api/package.json", "utf8"),
    );

    expect(Boolean(pkg.scripts.worker)).toBe(args.includes("production"));
  },
);

test("init preserves a nonempty target", async () => {
  const app = await fixture({ "api/keep.txt": "user content" });
  const result = init(app.rootDir, ["api"]);

  expect(result.status).not.toBe(0);

  expect(await readFile(app.rootDir + "/api/keep.txt", "utf8")).toBe(
    "user content",
  );

  await expect(access(app.rootDir + "/api/package.json")).rejects.toThrow();
});

test("production starter patches PM2's vulnerable pinned YAML dependency", async () => {
  const app = await fixture();
  const result = init(app.rootDir, ["api", "--preset", "production"]);

  expect(result.status, result.stdout + result.stderr).toBe(0);

  const pkg = JSON.parse(
    await readFile(app.rootDir + "/api/package.json", "utf8"),
  );

  expect(pkg.resolutions?.["pm2/js-yaml"]).toBe("4.3.2");
});
