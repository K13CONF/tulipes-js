import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [artifactPath, preset = 'minimal', mode] = process.argv.slice(2);
if (!artifactPath || !['minimal', 'production'].includes(preset) || (mode && mode !== '--offline-only')) throw new Error('Usage: scaffold-smoke.mjs <artifacts> minimal|production [--offline-only]');
const offlineOnly = mode === '--offline-only';
const artifacts = resolve(artifactPath);
const workspace = mkdtempSync(join(tmpdir(), 'tulipes-packed-'));
const scripts = import.meta.dirname;
const started = Date.now();
const logs = resolve('reports', 'scaffold-' + preset + (offlineOnly ? '-offline' : ''));
mkdirSync(logs, { recursive: true });
let step = 0;
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180_000 });
  const file = join(logs, `${String(++step).padStart(2, '0')}-${command.split('/').at(-1)}.log`);
  writeFileSync(file, (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed; see ${file}\n${result.error ?? ''}\n${result.stderr ?? ''}`);
  return result.stdout;
}
try {
  run(process.execPath, [join(scripts, 'artifacts.mjs'), 'verify', artifacts], workspace);
  const manifest = JSON.parse(readFileSync(join(artifacts, 'manifest.json'), 'utf8'));
  const resolutions = Object.fromEntries(manifest.packages.map(pkg => [pkg.name, 'file:' + join(artifacts, pkg.file)]));
  const cliRoot = join(workspace, 'cli');
  mkdirSync(cliRoot);
  writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({ private: true, packageManager: 'yarn@4.18.0', dependencies: resolutions }));
  writeFileSync(join(cliRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  // Fresh generated projects intentionally create their first lockfile, even
  // when the outer runner sets CI=true. Repository installs stay immutable.
  run('yarn', ['install'], cliRoot, { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
  const bin = join(cliRoot, 'node_modules/@tulipes/core/dist/cli/bin.js');
  const app = join(workspace, 'app');
  run(process.execPath, [bin, 'init', app, '--preset', preset], workspace);
  if (preset === 'production') {
    // The installed generator must carry the browser policy with its auth code.
    const guide = readFileSync(join(app, 'docs/browser-auth.md'), 'utf8');
    const template = readFileSync(join(cliRoot, 'node_modules/@tulipes/core/templates/browser-auth.md'), 'utf8');
    if (guide !== template) throw new Error('Generated browser authentication guide differs from the packed template');
  }

  const pkgFile = join(app, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.resolutions = { ...pkg.resolutions, ...resolutions };
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
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
    console.log(`${preset}: packed offline declarations, typecheck and deterministic specs passed with network connections denied`);
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
        ${preset === 'production' ? `worker = await boot({ rootDir: import.meta.dirname, mode: 'worker', appEnv: 'production', handleSignals: false });
        assert.ok(worker.ctx.queues.workerCount > 0);
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
    console.log(`${preset}: packed install, generated types, tests, specs, backend/shutdown${preset === 'production' ? ' and worker' : ''} passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
