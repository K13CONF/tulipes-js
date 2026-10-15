// Verify a generated app's MCP process (0.13-S03.5), run from inside the app
// like start-smoke.mjs: `pnpm --silent mcp` exactly as the README tells a
// developer to register it, spoken to as newline-delimited JSON-RPC on stdio.
//
//   production  an API token issued through the running API, scoped to
//               hello:web:*, lists the in-scope tool only and runs it;
//               the admin's out-of-scope tool is not offered
//   minimal     a guest lists and runs hello_web_greet; MCP_ROLE is
//               refused when APP_ENV is production
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const production = existsSync('modules/auth');

/** Start `pnpm start` on an ephemeral port, run `use(base)`, stop it. */
async function withBackend(use) {
  const child = spawn('pnpm', ['start'], { env: { ...process.env, PORT: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(new Error('start exited before ready: ' + code + '\n' + output)));
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
    const base = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('startup timed out\n' + output)), 20_000); })]);
    return await use(base);
  } finally {
    clearTimeout(timer);
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10_000);
    try { await closed; } finally { clearTimeout(force); }
  }
}

/** One MCP session: initialize, then each call in order; returns the results and both streams. */
async function session(args, env, calls) {
  // Detached, so the whole group can be stopped: pnpm does not forward a
  // signal to `node mcp.ts` on every platform.
  const child = spawn('pnpm', ['--silent', 'mcp', ...args], { env: { ...process.env, ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => (stdout += chunk));
  child.stderr.on('data', chunk => (stderr += chunk));
  const exited = once(child, 'exit');
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const reply = async id => {
    for (let waited = 0; waited < 20_000; waited += 50) {
      const line = stdout.split('\n').find(candidate => candidate.includes(`"id":${id}`));
      if (line) return JSON.parse(line);
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`no MCP reply ${id}\nstderr: ${stderr}`);
  };
  const results = [];
  let forced = false;
  try {
    send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-smoke', version: '0' } } });
    await reply(0);
    send({ method: 'notifications/initialized' });
    for (const [index, call] of calls.entries()) {
      send({ id: index + 1, ...call });
      results.push((await reply(index + 1)).result);
    }
    // Nothing but the protocol on stdout: the banner, logs and audit lines are on stderr.
    for (const line of stdout.trim().split('\n')) assert.equal(JSON.parse(line).jsonrpc, '2.0', 'non-protocol line on stdout: ' + line);
  } finally {
    // Closing stdin is how a client ends a stdio session: the server shuts
    // the app down and exits. The group kill is the backstop.
    child.stdin.end();
    const force = setTimeout(() => { forced = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10_000);
    try { await exited; } finally { clearTimeout(force); }
  }
  assert.ok(!forced, 'pnpm mcp did not exit within 10s of its client closing stdin');
  return { results, stderr };
}

const names = result => result.tools.map(tool => tool.name);
const text = result => result.content[0].text;

if (production) {
  const secret = await withBackend(async base => {
    const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: JSON.stringify(body) });
    const login = await post('/api/v1/auth/login', { email: process.env.AUTH_ADMIN_EMAIL, password: process.env.AUTH_ADMIN_PASSWORD });
    assert.equal(login.status, 200);
    const issued = await post('/api/v1/auth/tokens', { name: 'mcp-smoke', scopes: ['hello:web:*'] }, (await login.json()).data.access_token);
    assert.equal(issued.status, 201);
    return (await issued.json()).data.secret;
  });
  const { results, stderr } = await session(['--token', secret], {}, [
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'hello_web_greetings', arguments: {} } },
    { method: 'tools/call', params: { name: 'hello_bo_greetings_reset', arguments: { confirm: true } } },
  ]);
  assert.deepEqual(names(results[0]), ['hello_web_greetings']);
  assert.ok(!results[1].isError, text(results[1]));
  assert.equal(results[2].isError, true);
  assert.match(stderr, /mcp mode · stdio · admin · scopes hello:web:\*/);
  assert.match(stderr, /"tool":"hello_web_greetings".*"outcome":"ok"/);
  console.log('mcp: a token scoped to hello:web:* lists and runs only hello_web_greetings over stdio');
} else {
  const { results } = await session([], { MCP_ROLE: '' }, [
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'hello_web_greet', arguments: { name: 'smoke' } } },
  ]);
  assert.deepEqual(names(results[0]), ['hello_web_greet']);
  assert.equal(text(results[1]), '{"data":{"message":"Hello, smoke"}}');
  const refused = spawnSync('pnpm', ['--silent', 'mcp'], { input: '', encoding: 'utf8', timeout: 20_000, env: { ...process.env, APP_ENV: 'production', MCP_ROLE: 'admin' } });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /refused when APP_ENV is production/);
  console.log('mcp: a guest lists and runs hello_web_greet over stdio; MCP_ROLE is refused in production');
}
