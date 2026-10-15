import { spawn, spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { fixture } from "../../core/tests/fixture.ts";

const cli = resolve("packages/cli/src/bin.ts");

function init(rootDir: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [cli, "init", ...args],
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
    [app.rootDir + "/api/verify.ts"],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PORT: "0", MONGO_URI: "", REDIS_URL: "" },
    },
  );

  expect(check.status, check.stdout + check.stderr).toBe(0);
});

/** One MCP exchange over a generated app's `node mcp.ts`, by hand: newline-delimited JSON-RPC on stdio. */
async function mcpSession(cwd: string, env: Record<string, string>, calls: { method: string; params?: unknown }[]) {
  const child = spawn(process.execPath, ["mcp.ts"], { cwd, env: { ...process.env, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise<number | null>((done) => child.on("exit", done));
  const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  const reply = async (id: number) => {
    for (let waited = 0; waited < 10_000; waited += 50) {
      const line = stdout.split("\n").find((candidate) => candidate.includes(`"id":${id}`));
      if (line) return JSON.parse(line) as { result?: Record<string, unknown>; error?: unknown };
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`no reply ${id}; stderr: ${stderr}`);
  };
  try {
    send({ id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    await reply(0);
    send({ method: "notifications/initialized" });
    const results = [];
    for (const [index, call] of calls.entries()) {
      send({ id: index + 1, ...call });
      results.push(await reply(index + 1));
    }
    return { results, stdout, stderr };
  } finally {
    child.stdin.end();
    child.kill();
    await exited;
  }
}

test("both presets serve their actions over MCP with `pnpm mcp`, and the minimal preset's MCP_ROLE identity is development only", async () => {
  const app = await fixture();
  const minimal = init(app.rootDir, ["api"]);
  expect(minimal.status, minimal.stdout + minimal.stderr).toBe(0);
  const production = init(app.rootDir, ["full", "--preset", "production"]);
  expect(production.status, production.stdout + production.stderr).toBe(0);

  for (const dir of ["api", "full"]) {
    const pkg = JSON.parse(await readFile(`${app.rootDir}/${dir}/package.json`, "utf8"));
    expect(pkg.scripts.mcp).toBe("node mcp.ts");
    expect(pkg.dependencies["@tulipes/mcp"]).toBeDefined();
    await access(`${app.rootDir}/${dir}/mcp.ts`);
    await access(`${app.rootDir}/${dir}/config/mcp.config.ts`);
  }
  expect(await readFile(`${app.rootDir}/full/config/mcp.config.ts`, "utf8")).toContain("identifyCredential");

  const { results, stdout, stderr } = await mcpSession(`${app.rootDir}/api`, { APP_ENV: "development", MCP_ROLE: "" }, [
    { method: "tools/list" },
    { method: "tools/call", params: { name: "hello_web_greet", arguments: { name: "Ada" } } },
  ]);
  expect((results[0]!.result!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["hello_web_greet"]);
  expect(results[1]!.result).toMatchObject({ content: [{ type: "text", text: '{"data":{"message":"Hello, Ada"}}' }] });
  // stdout carries the protocol and nothing else; the banner and the audit line are on stderr.
  expect(stdout.trim().split("\n").every((line) => JSON.parse(line).jsonrpc === "2.0")).toBe(true);
  expect(stderr).toContain("mcp mode · stdio · guest (from MCP_ROLE)");
  expect(stderr).toContain('"tool":"hello_web_greet"');

  const refused = spawnSync(process.execPath, ["mcp.ts"], {
    cwd: `${app.rootDir}/api`, encoding: "utf8", timeout: 10_000, input: "",
    env: { ...process.env, APP_ENV: "production", MCP_ROLE: "admin" },
  });
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toMatch(/reads the role from MCP_ROLE, which is refused when APP_ENV is production/);
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

  expect(pkg.pnpm?.overrides?.["pm2>js-yaml"]).toBe("4.3.2");
});

test("the production preset composes without queues or sockets: no files, dependencies, providers or scripts for them", async () => {
  const app = await fixture();
  const result = init(app.rootDir, ["api", "--preset", "production", "--no-queues", "--no-sockets"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("Generated without queues");
  expect(result.stdout).toContain("Generated without sockets");

  const root = app.rootDir + "/api";
  const pkg = JSON.parse(await readFile(root + "/package.json", "utf8"));
  expect(pkg.tulipes.providers).toEqual({ models: "@tulipes/mongoose", settings: "@tulipes/mongoose/settings" });
  expect(pkg.scripts.worker).toBeUndefined();
  expect(Object.keys(pkg.dependencies)).not.toContain("@tulipes/bullmq");
  expect(Object.keys(pkg.dependencies)).not.toContain("@tulipes/socket.io");

  for (const path of ["worker.ts", "modules/users/queues", "modules/users/sockets", "modules/hello/queues", "modules/hello/sockets", "modules/agents"]) {
    await expect(access(root + "/" + path)).rejects.toThrow();
  }
  for (const module of ["users", "hello"]) {
    const manifest = JSON.parse(await readFile(`${root}/modules/${module}/package.json`, "utf8"));
    expect(Object.keys(manifest.dependencies)).not.toContain("@tulipes/bullmq");
    expect(Object.keys(manifest.dependencies)).not.toContain("@tulipes/socket.io");
  }
  const ecosystem = await readFile(root + "/ecosystem.config.cjs", "utf8");
  expect(ecosystem).not.toContain("worker.ts");
  const users = await readFile(root + "/modules/users/controllers/bo.users.controllers.ts", "utf8");
  expect(users).not.toContain("queues");
  const greetings = await readFile(root + "/modules/hello/controllers/web/hello.greetings.controllers.ts", "utf8");
  expect(greetings).not.toContain("requireQueues");
  // The app still declares REDIS_URL: the cache and rate limiter are app-owned.
  const core = JSON.parse(await readFile(root + "/modules/core/package.json", "utf8"));
  expect(core.tulipes.env.redisUrl).toMatchObject({ key: "REDIS_URL" });
});
