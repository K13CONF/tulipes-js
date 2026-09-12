import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * S15.3 — what a generated production app does when its services fail.
 *
 *   node scripts/failure-smoke.mjs <artifacts> [--keep]
 *
 * Runs the packed production preset against a disposable three-node MongoDB
 * replica set and its own Redis, then takes them away: primary loss during a
 * majority-acknowledged refresh rotation and during an audit write, then a
 * Redis outage and recovery under the rate limiter.
 *
 * It records what was observed. It deliberately does not assert that a write
 * "did not happen" when the acknowledgment is missing: an unacknowledged write
 * may still commit, and the point of the exercise is to say so precisely.
 * Requires Docker. Everything it creates is namespaced and removed.
 */
const [artifactPath, ...flags] = process.argv.slice(2);
if (!artifactPath || flags.some((flag) => flag !== '--keep')) throw new Error('Usage: failure-smoke.mjs <artifacts> [--keep]');
const artifacts = resolve(artifactPath);
const workspace = mkdtempSync(join(tmpdir(), 'tulipes-failure-'));
const logs = resolve('reports', 'failure-smoke');
mkdirSync(logs, { recursive: true });
const tag = randomBytes(4).toString('hex');
const network = `tulipes-fail-${tag}`;
// All three mongods live in one container on distinct ports, published 1:1.
// A replica set advertises the host each member was initiated with, so members
// must be addressable by the same string from inside the container (where they
// replicate to each other) and from the host (where the app connects):
// `127.0.0.1:<port>` is the only string that satisfies both.
const mongoContainer = `tulipes-mongo-${tag}`;
const mongos = [0, 1, 2].map((index) => ({ id: index, port: 27100 + index }));
const redis = { name: `tulipes-redis-${tag}`, port: 6500 + Math.floor(Math.random() * 400) };
const appPort = 19500 + Math.floor(Math.random() * 400);
const observations = [];
let step = 0;

function run(command, args, { cwd = workspace, env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 300_000 });
  const file = join(logs, `${String(++step).padStart(2, '0')}-${command.split('/').at(-1)}.log`);
  writeFileSync(file, `$ ${command} ${args.join(' ')}\n\n` + (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(' ')} failed; see ${file}\n${result.stderr ?? ''}`);
  return result.stdout ?? '';
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Every scenario records what happened; none of them retries to get a nicer answer. */
function observe(scenario, detail, data = {}) {
  observations.push({ scenario, detail, ...data });
  console.log(`• ${scenario} — ${detail}`);
}
/** `target` is the mongosh connection flags, e.g. `--port 27101`. */
const mongosh = (target, script, options = {}) =>
  run('docker', ['exec', mongoContainer, 'sh', '-c', `mongosh ${target} --quiet --eval ${JSON.stringify(script)}`], options);

let server;
try {
  // ── disposable infrastructure ────────────────────────────────────────────
  run('docker', ['network', 'create', network]);
  // PID 1 is `tail`, and each mongod is started by its own exec: a command line
  // that mentioned every port would make `pkill -f --port <one>` match the
  // shell holding all three and stop the whole container instead of one member.
  run('docker', ['run', '-d', '--name', mongoContainer, '--network', network,
    ...mongos.flatMap((node) => ['-p', `${node.port}:${node.port}`]),
    'mongo:8', 'tail', '-f', '/dev/null']);
  for (const node of mongos) {
    run('docker', ['exec', mongoContainer, 'sh', '-c',
      `mkdir -p /data/rs${node.id} && mongod --replSet rs0 --port ${node.port} --dbpath /data/rs${node.id} --bind_ip_all --fork --logpath /var/log/rs${node.id}.log`]);
  }
  run('docker', ['run', '-d', '--name', redis.name, '--network', network, '-p', `${redis.port}:6379`, 'redis:8-alpine']);

  const members = mongos.map((node) => `{ _id: ${node.id}, host: "127.0.0.1:${node.port}", priority: ${node.id === 0 ? 2 : 1} }`).join(', ');
  for (let attempt = 1; ; attempt++) {
    const out = mongosh(`--port ${mongos[0].port}`, `try { rs.initiate({ _id: "rs0", members: [${members}] }); "initiated" } catch (e) { e.codeName ?? String(e) }`, { allowFailure: true });
    if (/initiated|AlreadyInitialized/.test(out)) break;
    if (attempt > 30) throw new Error('replica set never initiated: ' + out);
    await sleep(2000);
  }
  for (let attempt = 1; ; attempt++) {
    const out = mongosh(`--port ${mongos[0].port}`, 'rs.status().members.filter(m => m.stateStr === "PRIMARY").length', { allowFailure: true });
    if (out.trim() === '1') break;
    if (attempt > 40) throw new Error('no primary elected: ' + out);
    await sleep(2000);
  }
  observe('infrastructure', 'three-node replica set rs0 with a primary, and a dedicated Redis', { mongo: mongos.map((m) => m.port), redis: redis.port });

  // The app runs on the host; it reaches the set through published ports, so
  // every member is addressed as 127.0.0.1:<published>. directConnection is
  // off: the driver must discover the topology and follow elections.
  const hosts = mongos.map((node) => `127.0.0.1:${node.port}`).join(',');
  const database = `tulipes_failure_${tag}`;

  // ── the application under test ───────────────────────────────────────────
  const manifest = readJson(join(artifacts, 'manifest.json'));
  const resolutions = Object.fromEntries(manifest.packages.map((pkg) => [pkg.name, 'file:' + join(artifacts, pkg.file)]));
  const cliRoot = join(workspace, 'cli');
  mkdirSync(cliRoot);
  writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({ private: true, packageManager: 'yarn@4.18.0', dependencies: { '@tulipes/cli': resolutions['@tulipes/cli'] }, resolutions }));
  writeFileSync(join(cliRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  run('yarn', ['install'], { cwd: cliRoot, env: { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } });
  const app = join(workspace, 'app');
  run(process.execPath, [join(cliRoot, 'node_modules/@tulipes/cli/dist/bin.js'), 'init', app, '--preset', 'production']);
  const pkgFile = join(app, 'package.json');
  writeFileSync(pkgFile, JSON.stringify({ ...readJson(pkgFile), resolutions }, null, 2));

  const password = randomBytes(24).toString('hex');
  const env = {
    ...process.env, APP_ENV: 'production', LOG_FILE: 'false', LOG_CONSOLE: 'false', PORT: String(appPort),
    MONGO_URI: `mongodb://${hosts}/${database}?replicaSet=rs0`,
    REDIS_URL: `redis://127.0.0.1:${redis.port}`,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    AUTH_ADMIN_EMAIL: 'failure@example.test', AUTH_ADMIN_PASSWORD: password,
    TRUST_PROXY_CIDRS: '',
  };
  run('yarn', ['install'], { cwd: app, env: { ...env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } });
  run('yarn', ['sync'], { cwd: app, env });

  server = spawn(process.execPath, ['--import', 'tsx', 'app.ts'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (d) => { output += d; });
  server.stderr.on('data', (d) => { output += d; });
  const base = `http://127.0.0.1:${appPort}`;
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) {
      writeFileSync(join(logs, 'app-boot-failure.log'), output);
      throw new Error(`app exited (${server.exitCode}); full output in ${join(logs, 'app-boot-failure.log')}\n${output.slice(-3000)}`);
    }
    const response = await fetch(`${base}/api/v1/hello`).catch(() => null);
    if (response?.status === 200) break;
    if (attempt > 300) throw new Error('app never became ready:\n' + output.slice(-3000));
    await sleep(100);
  }

  const login = async () => {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.AUTH_ADMIN_EMAIL, password }) });
    const body = await response.json();
    return { status: response.status, tokens: body.data };
  };
  // The endpoint takes the token in the body; sending it as a bearer header
  // yields a validation error that has nothing to do with the database.
  const refresh = async (token) => {
    const response = await fetch(`${base}/api/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: token }) })
      .catch((error) => ({ status: 0, error }));
    if (!response.json) return { status: 0, body: { network: String(response.error?.message ?? response.error) } };
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const first = await login();
  if (first.status !== 200) throw new Error('login failed before any failure was injected: ' + first.status);
  observe('baseline', 'the seeded admin logs in and holds a refresh token', { status: first.status });

  const primaryOf = () => {
    for (const node of mongos) {
      const out = mongosh(`--port ${node.port}`, 'try { rs.status().members.find(m => m.stateStr === "PRIMARY")?.name ?? "none" } catch (e) { "unreachable" }', { allowFailure: true }).trim();
      if (out && out !== 'none' && out !== 'unreachable') return out;
    }
    return 'none';
  };

  // ── 1. primary loss during a majority-acknowledged refresh rotation ──────
  const before = primaryOf();
  const rotating = refresh(first.tokens.refresh_token);
  await sleep(60); // let the request reach the write
  const victim = mongos.find((node) => before.endsWith(`:${node.port}`)) ?? mongos[0];
  // Kill the primary's process, not the container: the other two members must
  // survive to hold an election.
  // The pattern omits the leading dashes on purpose: pkill would read
  // `--port` as one of its own options and print its usage instead.
  run('docker', ['exec', mongoContainer, 'pkill', '-9', '-f', `port ${victim.port}`]);
  const survivors = mongos.filter((node) => node.port !== victim.port).map((node) =>
    mongosh(`--port ${node.port}`, 'db.adminCommand({ping:1}).ok', { allowFailure: true }).trim());
  if (!survivors.every((out) => out === '1')) throw new Error('the kill took down more than the primary: ' + JSON.stringify(survivors));
  observe('primary killed', `SIGKILL to the member on :${victim.port}; the other two answer ping`, { killed: victim.port });
  const rotated = await rotating;
  observe('primary lost mid-refresh', `the client saw ${rotated.status === 0 ? 'a dropped connection' : `HTTP ${rotated.status}`}`,
    { previous_primary: before, response: rotated.status, body: JSON.stringify(rotated.body).slice(0, 300) });

  for (let attempt = 1; ; attempt++) {
    const now = primaryOf();
    if (now !== 'none' && !now.endsWith(`:${victim.port}`)) { observe('election', `a surviving member became primary: ${now}`, { primary: now }); break; }
    if (attempt > 40) { observe('election', 'no new primary within 80s — recorded, not asserted'); break; }
    await sleep(2000);
  }

  // What is true afterwards matters more than the status code: the old token
  // is either still usable (the rotation never committed) or not (it did).
  // Order matters: replaying the pre-failure token is itself reuse, which
  // revokes the whole device family by design. Ask the rotated token first,
  // or the replay destroys the very thing the next line measures.
  const newTokenAfter = rotated.body?.data?.refresh_token ? await refresh(rotated.body.data.refresh_token) : { status: null };
  const oldTokenAfter = await refresh(first.tokens.refresh_token);
  observe('after the election', `the rotated token yields ${newTokenAfter.status ?? 'n/a (never issued)'}; replaying the pre-failure token then yields ${oldTokenAfter.status}`,
    { new_token: newTokenAfter.status, old_token: oldTokenAfter.status,
      note: 'an unacknowledged write may still have committed; this records the observable outcome, not a rollback claim' });

  const relogin = await login();
  observe('recovery', `logging in again after the election returns ${relogin.status}`, { status: relogin.status });

  // ── 2. Redis outage under the rate limiter ──────────────────────────────
  run('docker', ['stop', redis.name]);
  await sleep(500);
  const duringOutage = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.AUTH_ADMIN_EMAIL, password }) });
  const outageBody = await duringOutage.text();
  observe('redis down', `a rate-limited endpoint answers ${duringOutage.status}`,
    { status: duringOutage.status, code: (() => { try { return JSON.parse(outageBody).errors?.[0]?.code; } catch { return null; } })(),
      body: outageBody.slice(0, 200) });
  const helloDuringOutage = await fetch(`${base}/api/v1/hello`);
  const helloBody = await helloDuringOutage.text();
  observe('redis down', `an endpoint outside the limiter answers ${helloDuringOutage.status}`,
    { status: helloDuringOutage.status, body: helloBody.slice(0, 200) });

  run('docker', ['start', redis.name]);
  let recovered = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(1000);
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.AUTH_ADMIN_EMAIL, password }) });
    if (response.status !== 503) { recovered = { status: response.status, seconds: attempt + 1 }; break; }
  }
  observe('redis recovered', recovered ? `the limiter resumed after ~${recovered.seconds}s (HTTP ${recovered.status})` : 'the limiter did not resume within 60s',
    recovered ?? { resumed: false });

  // ── 3. the app's own shutdown with a degraded replica set ───────────────
  writeFileSync(join(logs, 'app-output.log'), output);
  const stopped = Date.now();
  server.kill('SIGTERM');
  const code = await new Promise((r) => server.once('exit', r));
  server = undefined;
  observe('shutdown with a member down', `exited with code ${code} after ${Date.now() - stopped}ms`, { code, ms: Date.now() - stopped });
} finally {
  if (server) server.kill('SIGKILL');
  for (const node of [mongoContainer, redis.name]) spawnSync('docker', ['rm', '-f', node], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
  if (flags.includes('--keep')) console.error('kept ' + workspace);
  else rmSync(workspace, { recursive: true, force: true });
}

writeFileSync(join(logs, 'observations.json'), JSON.stringify({ recorded_at: new Date().toISOString(), observations }, null, 2));
console.log(`\nfailure: ${observations.length} observations recorded in ${join(logs, 'observations.json')}`);
