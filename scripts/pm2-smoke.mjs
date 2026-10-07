// Executed inside the isolated, installed production starter: PM2 drives
// both processes straight from TypeScript with node — no loader, no build —
// through the committed ecosystem file, and a PM2 restart brings them back.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import pm2 from "pm2";
import config from "./ecosystem.config.cjs";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const call = (method, ...args) =>
  new Promise((resolve, reject) =>
    pm2[method](...args, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
const disconnect = () =>
  new Promise((resolve) => pm2.disconnect(() => resolve()));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
for (const app of config.apps) {
  app.env = { ...app.env_production, PORT: String(port) };
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (
        (
          await fetch("http://127.0.0.1:" + port + "/api/v1/hello", {
            signal: AbortSignal.timeout(1000),
          })
        ).status === 200
      )
        return;
    } catch {}
    await setTimeout(100);
  }
  throw new Error("PM2-supervised backend did not become ready");
}
await call("connect");
try {
  await call("start", config);
  await ready();
  const before = await call("list");
  // The app's own processes: backend, plus a worker when queues are generated.
  const expectedOwned = config.apps.length;
  const root = realpathSync(process.cwd());
  const owned = before.filter(
    (entry) => realpathSync(entry.pm2_env.pm_cwd) === root,
  );
  assert.equal(owned.length, expectedOwned);
  assert.ok(owned.every((process) => process.pid > 0));
  for (const entry of owned) {
    // Plain node runs the TypeScript entrypoint: no interpreter, no loader.
    assert.ok(
      !String(entry.pm2_env.exec_interpreter ?? "").includes("tsx"),
      `PM2 drives ${entry.name} through ${entry.pm2_env.exec_interpreter}`,
    );
    assert.match(entry.pm2_env.pm_exec_path, /\.ts$/);
  }

  // A PM2 restart replaces every owned process and the backend answers again.
  await call("restart", "all");
  await ready();
  const after = await call("list");
  for (const previous of owned) {
    const current = after.find((entry) => entry.pm_id === previous.pm_id);
    assert.ok(current?.pid > 0);
    assert.notEqual(current.pid, previous.pid, `${previous.name} was not restarted`);
  }
  console.log(
    `PM2 started ${owned.length} process(es) from TypeScript with node and restarted them`,
  );
} finally {
  await disconnect();
  try {
    await call("connect");
    await call("delete", "all");
    await call("killDaemon");
  } finally {
    await disconnect();
  }
}
// PM2 can retain client bookkeeping after killing its daemon. Verify daemon
// removal before ending this one-shot checker; app shutdown is checked above.
const { existsSync } = await import("node:fs");
assert.equal(existsSync(join(process.env.PM2_HOME, "pm2.pid")), false);
process.exit(0);
