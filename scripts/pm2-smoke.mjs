// Executed inside the isolated, installed production starter.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import pm2 from 'pm2';
import config from './ecosystem.config.cjs';
import { spawnSync } from 'node:child_process';

const call = (method, ...args) => new Promise((resolve, reject) => pm2[method](...args, (error, value) => error ? reject(error) : resolve(value)));
const disconnect = () => new Promise(resolve => pm2.disconnect(() => resolve()));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
for (const app of config.apps) {
  app.env = { ...app.env_production, PORT: String(port) };
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch('http://127.0.0.1:' + port + '/api/v1/hello', { signal: AbortSignal.timeout(1000) })).status === 200) return; } catch {}
    await setTimeout(100);
  }
  throw new Error('PM2-supervised backend did not become ready');
}
await call('connect');
try {
  await call('start', config);
  await ready();
  const before = await call('list');
  assert.equal(before.length, 2);
  assert.ok(before.every(process => process.pid > 0));
  await disconnect();
  // Exercise the application's helper in its own process, as an admin script
  // would use it; the inspection client must not share its PM2 connection.
  const helper = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { restart } from './modules/settings/helpers/pm2.ts';
    const names = ${JSON.stringify(before.map(process => process.name))};
    const outcome = await restart(names);
    assert.equal(outcome.supervised, true);
    assert.deepEqual(outcome.restarted.sort(), names.sort());
  `], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(helper.status, 0, helper.stdout + helper.stderr);
  await call('connect'); // The helper disconnects after its operation.
  await ready();
  const after = await call('list');
  assert.ok(after.every(process => process.pid > 0 && process.pid !== before.find(old => old.name === process.name).pid));
} finally {
  await disconnect();
  try { await call('connect'); await call('delete', 'all'); await call('killDaemon'); }
  finally { await disconnect(); }
}
// PM2 can retain client bookkeeping after killing its daemon. Verify daemon
// removal before ending this one-shot checker; app shutdown is checked above.
const { existsSync } = await import('node:fs');
const { join } = await import('node:path');
assert.equal(existsSync(join(process.env.PM2_HOME, 'pm2.pid')), false);
process.exit(0);
