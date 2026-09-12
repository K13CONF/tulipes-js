import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { fixture } from "../../core/tests/fixture.js";

const cli = resolve("packages/cli/src/bin.ts");

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
  ["api", "--no-queues"],
  ["api", "--preset", "minimal", "--no-sockets"],
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

test("the production preset composes without queues or sockets: no files, dependencies, providers or scripts for them", async () => {
  const app = await fixture();
  const result = init(app.rootDir, ["api", "--preset", "production", "--no-queues", "--no-sockets"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("Generated without queues");
  expect(result.stdout).toContain("Generated without sockets");

  const root = app.rootDir + "/api";
  const pkg = JSON.parse(await readFile(root + "/package.json", "utf8"));
  expect(pkg.tulipes.providers).toEqual({ models: "@tulipes/mongoose" });
  expect(pkg.scripts.worker).toBeUndefined();
  expect(Object.keys(pkg.dependencies)).not.toContain("@tulipes/bullmq");
  expect(Object.keys(pkg.dependencies)).not.toContain("@tulipes/socket.io");

  for (const path of ["worker.ts", "modules/users/queues", "modules/users/sockets", "modules/hello/queues", "modules/hello/sockets"]) {
    await expect(access(root + "/" + path)).rejects.toThrow();
  }
  for (const module of ["users", "hello"]) {
    const manifest = JSON.parse(await readFile(`${root}/modules/${module}/package.json`, "utf8"));
    expect(Object.keys(manifest.dependencies)).not.toContain("@tulipes/bullmq");
    expect(Object.keys(manifest.dependencies)).not.toContain("@tulipes/socket.io");
  }
  const ecosystem = await readFile(root + "/ecosystem.config.cjs", "utf8");
  expect(ecosystem).not.toContain("worker.ts");
  const users = await readFile(root + "/modules/users/controllers/users.controllers.ts", "utf8");
  expect(users).not.toContain("queues");
  const greetings = await readFile(root + "/modules/hello/controllers/greetings.controllers.ts", "utf8");
  expect(greetings).not.toContain("requireQueues");
  // The app still declares REDIS_URL: the cache and rate limiter are app-owned.
  const meta = JSON.parse(await readFile(root + "/modules/core/meta.variables.json", "utf8"));
  expect(meta.variables.some((v: { name: string }) => v.name === "REDIS_URL")).toBe(true);
});
