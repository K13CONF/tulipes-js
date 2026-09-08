// Verify the generated user-facing start commands, including watcher cleanup.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

for (const script of ['dev', 'start']) {
  const child = spawn('yarn', [script], { env: { ...process.env, PORT: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(new Error(script + ' exited before ready: ' + code + '\n' + output)));
    const collect = chunk => {
      output += chunk.toString();
      const match = output.replace(/\x1b\[[0-9;]*m/g, '').match(/http:\/\/localhost:(\d+)/);
      if (match) resolve('http://127.0.0.1:' + match[1]);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
  });
  let timer;
  try {
    const base = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(script + ' startup timed out\n' + output)), 20_000); })]);
    assert.equal((await fetch(base + '/api/v1/hello', { signal: AbortSignal.timeout(5000) })).status, 200);
  } finally {
    clearTimeout(timer);
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10_000);
    try { await closed; } finally { clearTimeout(force); }
  }
}
