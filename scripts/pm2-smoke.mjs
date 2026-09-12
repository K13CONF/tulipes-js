// Executed inside the isolated, installed production starter.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import pm2 from "pm2";
import config from "./ecosystem.config.cjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
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
  // The daemon is deliberately shared with another app, including a name clash.
  const foreignRoot = join(process.env.PM2_HOME, "unrelated-app");
  mkdirSync(foreignRoot);
  const foreignScript = join(foreignRoot, "idle.mjs");
  writeFileSync(foreignScript, "setInterval(() => {}, 1000);\n");
  for (const name of [config.apps[0].name, "unrelated-app"]) {
    // The ecosystem-object overload restarts existing names. Starting by script
    // path creates the separate process needed to exercise the name collision.
    await call("start", foreignScript, {
      name,
      cwd: foreignRoot,
      interpreter: process.execPath,
      force: true,
    });
  }
  const before = await call("list");
  // The app's own processes (backend, plus a worker when queues are generated)
  // and the two foreign ones started above.
  const expectedOwned = config.apps.length;
  assert.equal(before.length, expectedOwned + 2);
  assert.ok(before.every((process) => process.pid > 0));
  const root = realpathSync(process.cwd());
  const owned = before.filter(
    (entry) => realpathSync(entry.pm2_env.pm_cwd) === root,
  );
  assert.equal(owned.length, expectedOwned);
  assert.equal(
    before.filter((entry) => entry.name === config.apps[0].name).length,
    2,
  );
  await disconnect();
  // Exercise the application's helper in its own process, as an admin script
  // would use it; the inspection client must not share its PM2 connection.
  const helper = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { restart } from './modules/settings/helpers/pm2.ts';
    const names = ${JSON.stringify(owned.map((process) => process.name))};
    await assert.rejects(restart([names[0], 'unrelated-app']), { code: 'INVALID_RESTART_TARGETS' });
    await assert.rejects(restart(['all']), { code: 'INVALID_RESTART_TARGETS' });
    const outcome = await restart([]);
    assert.equal(outcome.supervised, true);
    assert.deepEqual(outcome.restarted.sort(), names.sort());
  `,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(helper.status, 0, helper.stdout + helper.stderr);
  await call("connect"); // The helper disconnects after its operation.
  await ready();
  const after = await call("list");
  assert.equal(after.length, before.length);
  for (const entry of after) {
    const previous = before.find((old) => old.pm_id === entry.pm_id);
    assert.ok(previous && entry.pid > 0);
    if (owned.some((process) => process.pm_id === entry.pm_id))
      assert.notEqual(entry.pid, previous.pid);
    else
      assert.equal(
        entry.pid,
        previous.pid,
        "Unrelated application was restarted",
      );
  }

  // Give this disposable seed account the role required by the settings route.
  // Use the installed app's model registry, without assuming collection names.
  const promote = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { boot } from '@tulipes/core/boot';
    const handle = await boot({ rootDir: process.cwd(), mode: 'script', appEnv: 'production', handleSignals: false });
    try {
      await handle.ctx.models.get('User').updateOne(
        { email: process.env.AUTH_ADMIN_EMAIL.toLowerCase() },
        { $set: { role: 'sysadmin' } },
      );
    } finally {
      await handle.shutdown();
    }
  `,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(promote.status, 0, promote.stdout + promote.stderr);

  const base = "http://127.0.0.1:" + port;
  const login = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.AUTH_ADMIN_EMAIL,
      password: process.env.AUTH_ADMIN_PASSWORD,
    }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.access_token;
  const beforeHttp = await call("list");

  // This request includes the backend serving it. Parsing the full response
  // proves the self-restart did not interrupt acknowledgment on this runner.
  const reboot = await fetch(base + "/api/v1/settings/reboot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(reboot.status, 202);
  const acknowledgment = await reboot.json();
  assert.equal(acknowledgment.data.accepted, true);
  assert.deepEqual(
    acknowledgment.data.scheduled.sort(),
    owned.map((entry) => entry.name).sort(),
  );

  let afterHttp;
  for (let attempt = 0; attempt < 150; attempt++) {
    afterHttp = await call("list");
    if (
      owned.every((entry) => {
        const previous = beforeHttp.find(
          (process) => process.pm_id === entry.pm_id,
        );
        const current = afterHttp.find(
          (process) => process.pm_id === entry.pm_id,
        );
        return current?.pid > 0 && current.pid !== previous.pid;
      })
    )
      break;

    await setTimeout(100);
  }

  for (const previous of beforeHttp) {
    const current = afterHttp.find((entry) => entry.pm_id === previous.pm_id);
    assert.ok(current?.pid > 0);

    if (owned.some((entry) => entry.pm_id === previous.pm_id)) {
      assert.notEqual(
        current.pid,
        previous.pid,
        "Accepted HTTP restart did not replace an owned process",
      );
    } else {
      assert.equal(
        current.pid,
        previous.pid,
        "HTTP restart affected an unrelated application",
      );
    }
  }

  await ready();
  console.log(
    "PM2 HTTP self-restart delivered a complete 202 and preserved unrelated PIDs",
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
