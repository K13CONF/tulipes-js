import { existsSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [artifactPath, preset = 'minimal', ...flags] = process.argv.slice(2);
if (!artifactPath || !['minimal', 'production'].includes(preset) || flags.some(flag => !['--offline-only', '--registry', '--no-queues', '--no-sockets'].includes(flag))) {
  throw new Error('Usage: scaffold-smoke.mjs <artifacts> minimal|production [--offline-only] [--registry] [--no-queues] [--no-sockets]');
}
const offlineOnly = flags.includes('--offline-only');
// Feature composition (S14): the production preset without one of its optional providers.
const features = { queues: !flags.includes('--no-queues'), sockets: !flags.includes('--no-sockets') };
const initFlags = [...(features.queues ? [] : ['--no-queues']), ...(features.sockets ? [] : ['--no-sockets'])];
const variant = preset + (features.queues ? '' : '-no-queues') + (features.sockets ? '' : '-no-sockets');
// --registry: the manifest names published versions; everything installs from
// npm at exactly those versions and no local archive may be used. Yarn's
// release-age gate is lifted only for the exact versions whose bytes the
// caller has already verified against the manifest (artifacts.mjs verify).
const registry = flags.includes('--registry');
const artifacts = resolve(artifactPath);
const workspace = mkdtempSync(join(tmpdir(), 'tulipes-packed-'));
const scripts = import.meta.dirname;
const started = Date.now();
const logs = resolve('reports', 'scaffold-' + variant + (offlineOnly ? '-offline' : '') + (registry ? '-registry' : ''));
mkdirSync(logs, { recursive: true });
let step = 0;
function run(command, args, cwd, env = process.env, attempt = 1) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180_000 });
  const file = join(logs, `${String(++step).padStart(2, '0')}-${command.split('/').at(-1)}.log`);
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(file, output);
  // Yarn 4.18 occasionally aborts a fetch with an internal p-cancelable error
  // on hosted runners; one retry of the install alone, never of a check.
  if (result.status !== 0 && attempt === 1 && command === 'yarn' && args[0] === 'install' && output.includes('onCancel')) {
    console.error(`yarn install hit a Yarn-internal cancellation (see ${file}); retrying once`);
    return run(command, args, cwd, env, 2);
  }
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed; see ${file}\n${result.error ?? ''}\n${result.stderr ?? ''}`);
  return result.stdout;
}
try {
  run(process.execPath, [join(scripts, 'artifacts.mjs'), 'verify', artifacts], workspace);
  const manifest = JSON.parse(readFileSync(join(artifacts, 'manifest.json'), 'utf8'));
  const resolutions = Object.fromEntries(manifest.packages.map(pkg => [pkg.name, registry ? pkg.version : 'file:' + join(artifacts, pkg.file)]));
  const preapproval = registry ? '\nnpmPreapprovedPackages:\n' + manifest.packages.map(pkg => `  - "${pkg.name}@${pkg.version}"\n`).join('') : '';
  // The launcher installs the CLI alone (which brings the core it bundles): a
  // global `tulipes` never carries a provider, and an all-archive launcher
  // would hoist one next to the app and hide a missing dependency. Everything
  // else resolves from the app — including its own @tulipes/cli devDependency.
  const cliRoot = join(workspace, 'cli');
  mkdirSync(cliRoot);
  writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({ private: true, packageManager: 'yarn@4.18.0', dependencies: { '@tulipes/cli': resolutions['@tulipes/cli'] }, resolutions: { '@tulipes/core': resolutions['@tulipes/core'] } }));
  writeFileSync(join(cliRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n' + preapproval);
  // Fresh generated projects intentionally create their first lockfile, even
  // when the outer runner sets CI=true. Repository installs stay immutable.
  run('yarn', ['install'], cliRoot, { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
  const bin = join(cliRoot, 'node_modules/@tulipes/cli/dist/bin.js');
  const app = join(workspace, 'app');
  run(process.execPath, [bin, 'init', app, '--preset', preset, ...initFlags], workspace);
  if (preset === 'production') {
    // The installed generator must carry the browser policy with its auth code.
    const guide = readFileSync(join(app, 'docs/browser-auth.md'), 'utf8');
    const template = readFileSync(join(cliRoot, 'node_modules/@tulipes/cli/templates/browser-auth.md'), 'utf8');
    if (guide !== template) throw new Error('Generated browser authentication guide differs from the packed template');
  }

  const pkgFile = join(app, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  // Packed: pin the app to the archives. Registry: keep the generated ranges
  // untouched and let them resolve from npm, as a user's install would.
  if (!registry) pkg.resolutions = { ...pkg.resolutions, ...resolutions };
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  if (preapproval) writeFileSync(join(app, '.yarnrc.yml'), readFileSync(join(app, '.yarnrc.yml'), 'utf8') + preapproval);
  const env = { ...process.env, APP_ENV: 'test', PORT: '0', LOG_FILE: 'false', LOG_CONSOLE: 'false' };
  if (preset === 'production' && !offlineOnly) {
    if (!env.TEST_MONGO_URI || !env.TEST_REDIS_URL) throw new Error('Production smoke requires dedicated test infrastructure');
    const mongo = new URL(env.TEST_MONGO_URI);
    mongo.pathname = '/tulipes_smoke_' + randomBytes(6).toString('hex');
    Object.assign(env, { TEST_MONGO_URI: mongo.href, MONGO_URI: mongo.href, REDIS_URL: env.TEST_REDIS_URL,
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      AUTH_ADMIN_EMAIL: 'smoke@example.test', AUTH_ADMIN_PASSWORD: randomBytes(32).toString('hex') });
  } else {
    for (const name of ['MONGO_URI', 'REDIS_URL', 'TEST_MONGO_URI', 'TEST_REDIS_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'AUTH_ADMIN_EMAIL', 'AUTH_ADMIN_PASSWORD']) delete env[name];
  }
  run('yarn', ['install'], app, { ...env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
  if (registry) for (const installedRoot of [cliRoot, app]) {
    for (const expected of manifest.packages) {
      const installed = join(installedRoot, 'node_modules', expected.name, 'package.json');
      if (!existsSync(installed)) continue; // the launcher holds core only; minimal holds no provider
      const actual = JSON.parse(readFileSync(installed, 'utf8'));
      if (actual.version !== expected.version) throw new Error(`Registry installed ${actual.name}@${actual.version}, expected ${expected.version}`);
    }
    if (/"@tulipes\/[a-z]+@file:/.test(readFileSync(join(installedRoot, 'yarn.lock'), 'utf8'))) throw new Error('Registry installation used a local archive');
  }
  // Installation evidence, not runtime evidence: can the app, and can its
  // installed core, resolve the driver at all? Minimal must say no everywhere.
  const probe = run(process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    const targets = ['mongoose', 'mongodb', 'bson', '@tulipes/mongoose', 'bullmq', '@tulipes/bullmq', 'ioredis', 'socket.io', '@tulipes/socket.io'];
    const tooling = ['tsx', 'esbuild', '@tulipes/cli'];
    const from = anchor => Object.fromEntries(targets.map(t => { try { createRequire(anchor).resolve(t); return [t, true]; } catch { return [t, false]; } }));
    const coreEntry = createRequire(process.argv[1]).resolve('@tulipes/core');
    const fromCore = Object.fromEntries(tooling.map(t => { try { createRequire(coreEntry).resolve(t); return [t, true]; } catch { return [t, false]; } }));
    console.log(JSON.stringify({ app: from(process.argv[1]), core: from(coreEntry), cli: from(process.argv[2]), tooling_from_core: fromCore }));
  `, pkgFile, bin], app, env);
  const resolved = JSON.parse(probe.trim().split('\n').at(-1));
  writeFileSync(join(logs, 'resolve.json'), JSON.stringify(resolved, null, 2));
  // Minimal: absent from the app, from core's own directory and from the
  // launcher. Production: present for the app (its modules and providers own
  // them), never through the launcher; core's directory sees them only by hoisting.
  const expectations = preset === 'minimal' ? { app: false, core: false, cli: false } : { app: true, cli: false };
  // A production variant without a provider must not carry that provider's driver either.
  const omitted = new Set([...(features.queues ? [] : ['bullmq', '@tulipes/bullmq']), ...(features.sockets ? [] : ['socket.io', '@tulipes/socket.io'])]);
  for (const [anchor, expected] of Object.entries(expectations)) {
    for (const [target, found] of Object.entries(resolved[anchor])) {
      const want = anchor === 'app' && omitted.has(target) ? false : expected;
      if (found !== want) throw new Error(`${target} ${found ? 'resolves' : 'does not resolve'} from ${anchor} in the ${variant} preset; see ${join(logs, 'resolve.json')}`);
    }
  }
  // Tooling (tsx, esbuild, the CLI) is the app's devDependency, so a generated
  // app's core directory sees it by hoisting; `tooling_from_core` is recorded
  // for the report, and the core-only absence proof is the inventory harness.
  run(process.execPath, [join(scripts, 'audit.mjs'), join(logs, 'dependencies.jsonl')], app, env);
  for (const script of ['sync', 'typecheck']) run('yarn', [script], app, env);
  const guard = join(app, 'offline-guard.mjs');
  writeFileSync(guard, `import { Socket } from 'node:net';\nSocket.prototype.connect = function () { throw new Error('Offline inspection attempted a network connection'); };\n`);
  const offlineEnv = { ...env, APP_ENV: 'production', MONGO_URI: 'invalid', REDIS_URL: 'invalid',
    JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '', AUTH_ADMIN_PASSWORD: '' };
  run(process.execPath, ['--import', guard, bin, 'routes', '--offline'], app, offlineEnv);
  const generate = () => run(process.execPath, ['--import', guard, bin, 'spec', '--offline',
    '--openapi', 'docs/openapi.json', '--postman', 'docs/collection.json'], app, offlineEnv);
  generate();
  const first = ['openapi.json', 'collection.json'].map(file => readFileSync(join(app, 'docs', file), 'utf8'));
  generate();
  for (const [index, file] of ['openapi.json', 'collection.json'].entries()) {
    if (readFileSync(join(app, 'docs', file), 'utf8') !== first[index]) throw new Error('Offline output changed between processes: ' + file);
  }
  if (!offlineOnly) for (const script of ['check', 'test', 'spec']) run('yarn', [script], app, env);
  const spec = JSON.parse(readFileSync(join(app, 'docs/openapi.json'), 'utf8'));
  if (!spec.paths['/api/v1/hello']) throw new Error('Quick-start endpoint missing from generated specification');
  if (offlineOnly) {
    console.log(`${variant}: ${registry ? 'registry' : 'packed'} offline declarations, typecheck and deterministic specs passed with network connections denied`);
  } else {
    // Runtime checks live in a file inside the installed application; no source
    // workspace module can satisfy its imports.
    writeFileSync(join(app, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      import { boot } from '@tulipes/core/boot';
      const backend = await boot({ rootDir: import.meta.dirname, appEnv: 'production', handleSignals: false });
      let worker;
      try {
        const base = 'http://127.0.0.1:' + backend.server.address().port;
        assert.equal((await fetch(base + '/api/v1/hello')).status, 200);
        ${preset === 'production' ? `${features.queues ? `worker = await boot({ rootDir: import.meta.dirname, mode: 'worker', appEnv: 'production', handleSignals: false });
        assert.ok(worker.ctx.queues.workerCount > 0);` : `assert.equal(backend.ctx.queues, undefined);`}
        ${features.sockets ? `assert.ok(backend.ctx.sockets);` : `assert.equal(backend.ctx.sockets, undefined);`}
        const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.AUTH_ADMIN_EMAIL, password: process.env.AUTH_ADMIN_PASSWORD }) });
        assert.equal(login.status, 200);
        const token = (await login.json()).data.access_token;
        const failed = await fetch(base + '/users/boom', { headers: { authorization: 'Bearer ' + token } });
        assert.equal(failed.status, 500);
        const body = await failed.text();
        assert.ok(!body.includes('secret internals'));
        assert.ok(!body.includes('stack'));
        assert.equal(JSON.parse(body).success, false);` : `assert.equal(backend.ctx.models, undefined); assert.equal(backend.ctx.queues, undefined);
        assert.equal((await fetch(base + '/health')).status, 200);`}
      } finally { await worker?.shutdown(); await backend.shutdown(); }
    `);
    run(process.execPath, ['--import', 'tsx', 'smoke.mjs'], app, env);
    run(process.execPath, [join(scripts, 'start-smoke.mjs')], app, env);
    if (preset === 'production') {
      copyFileSync(join(scripts, 'pm2-smoke.mjs'), join(app, 'pm2-smoke.mjs'));
      run(process.execPath, ['--import', 'tsx', 'pm2-smoke.mjs'], app, { ...env, PM2_HOME: join(workspace, 'pm2') });
    }
    console.log(`${variant}: ${registry ? 'registry' : 'packed'} install, generated types, tests, specs, backend/shutdown${preset === 'production' && features.queues ? ' and worker' : ''} passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
} finally {
  // TULIPES_SMOKE_KEEP=1 leaves the generated app behind for a post-mortem.
  if (process.env.TULIPES_SMOKE_KEEP) console.error('kept ' + workspace);
  else rmSync(workspace, { recursive: true, force: true });
}
