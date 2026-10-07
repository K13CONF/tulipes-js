// HISTORICAL — S09.1 measurements were taken with yarn 4 at 3d56aed and are recorded in
// docs/design/mongoose-dependency-inventory.md. The repository moved to pnpm in 0.11; this harness
// still reads yarn.lock and calls yarn, so rerunning it needs a checkout from before that move.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * S09.1 measurement harness — the baseline every later extraction compares
 * against. Every fixture lives OUTSIDE the workspace with its own package
 * manager cache, so nothing hoisted in this repository can hide a dependency
 * an installed application would actually pull.
 *
 *   node scripts/s09-inventory.mjs baseline               identity + search register
 *   node scripts/s09-inventory.mjs install [A|B|C|D ...]  installation shapes
 *   node scripts/s09-inventory.mjs startup [A|B|C ...]    import / readiness / offline / shutdown
 *   node scripts/s09-inventory.mjs summary                markdown tables from the raw JSON
 *
 * Raw output: reports/s09-inventory/<short sha>/…  (git-ignored). Stable
 * numbers are copied by hand into docs/design/mongoose-dependency-inventory.md.
 * Fixture C (production) needs TEST_MONGO_URI / TEST_REDIS_URL and is recorded
 * as "not measured" without them; nothing here touches the developer's global
 * Yarn cache.
 */

const repo = resolve(import.meta.dirname, '..');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const sha = git(['rev-parse', '--short', 'HEAD']);
const out = join(repo, 'reports', 's09-inventory', sha);
const artifactsDir = join(out, 'artifacts');
const fixturesRoot = join(tmpdir(), `tulipes-s09-${sha}`);
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const SAMPLES = Number(process.env.S09_SAMPLES ?? 20);
const WARMUPS = Number(process.env.S09_WARMUPS ?? 3);
const INSTALL_RUNS = Number(process.env.S09_INSTALL_RUNS ?? 3);

// ───────────────────────────── shell helpers ─────────────────────────────

function run(command, args, { cwd = repo, env = process.env, timeout = 600_000, log } = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const ms = performance.now() - started;
  if (log) writeFileSync(log, `$ ${command} ${args.join(' ')}\n(cwd ${cwd}, ${ms.toFixed(0)}ms, status ${result.status})\n\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${result.stderr ?? result.error ?? ''}`);
  return { stdout: result.stdout, ms };
}

/** Environment for a fixture: no inherited services, secrets or NODE_PATH. */
function cleanEnv(extra = {}) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'TERM', 'COREPACK_HOME']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, CI: '1', YARN_ENABLE_TELEMETRY: '0', ...extra };
}

function yarnEnv(cache, extra = {}) {
  // Cache AND global folder per fixture, isolated from ~/.yarn/berry: with the
  // global cache disabled Yarn still uses the global folder as a mirror, so a
  // "fresh" run must wipe both; "warm" reuses what the same fixture fetched.
  return cleanEnv({ YARN_CACHE_FOLDER: join(cache, 'cache'), YARN_GLOBAL_FOLDER: join(cache, 'global'), YARN_ENABLE_GLOBAL_CACHE: 'false', YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_NODE_LINKER: 'node-modules', ...extra });
}

// ────────────────────────────── baseline ────────────────────────────────

function baseline() {
  mkdirSync(out, { recursive: true });
  const dirty = git(['status', '--porcelain']);
  const identity = {
    recorded_at: new Date().toISOString(),
    source: { sha: git(['rev-parse', 'HEAD']), short: sha, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: dirty ? dirty.split('\n') : [] },
    packages: Object.fromEntries(['core', 'spec'].map(name => { const pkg = readJson(join(repo, 'packages', name, 'package.json')); return [pkg.name, pkg.version]; })),
    lockfile: { sha256: createHash('sha256').update(readFileSync(join(repo, 'yarn.lock'))).digest('hex'), mongoose: lockEntries() },
    toolchain: { node: process.version, yarn: run('yarn', ['-v']).stdout.trim(), platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, cpus: cpus().length, memory_bytes: totalmem() },
    services: { TEST_MONGO_URI: process.env.TEST_MONGO_URI ? redact(process.env.TEST_MONGO_URI) : null, TEST_REDIS_URL: process.env.TEST_REDIS_URL ? redact(process.env.TEST_REDIS_URL) : null },
    policy: { samples: SAMPLES, warmups: WARMUPS, install_runs: INSTALL_RUNS },
  };
  writeJson(join(out, 'baseline.json'), identity);

  // Pack fresh archives from HEAD; the existing .artifacts may predate it.
  rmSync(artifactsDir, { recursive: true, force: true });
  run(process.execPath, [join(repo, 'scripts/artifacts.mjs'), 'prepare', artifactsDir], { log: join(out, 'pack.log') });
  const manifest = readJson(join(artifactsDir, 'manifest.json'));
  for (const pkg of manifest.packages) {
    const file = join(artifactsDir, pkg.file);
    const listing = run('tar', ['-tvzf', file]).stdout.trim().split('\n');
    pkg.archive_bytes = statSync(file).size;
    pkg.unpacked_bytes = listing.reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[4] ?? 0), 0);
    pkg.files = listing.length;
    // Composition: which part of the archive is runtime, CLI or scaffold material.
    pkg.composition = {};
    for (const line of listing) {
      const parts = line.trim().split(/\s+/); const size = Number(parts[4] ?? 0); const path = parts.at(-1) ?? '';
      const area = /^package\/dist\/cli\//.test(path) ? 'dist/cli' : /^package\/dist\//.test(path) ? 'dist/runtime' : /^package\/(templates|assets)\//.test(path) ? path.split('/')[1] : 'other';
      pkg.composition[area] = (pkg.composition[area] ?? 0) + size;
    }
    pkg.dts_mongoose = run('tar', ['-xOf', file, ...listing.map(l => l.trim().split(/\s+/).at(-1)).filter(p => p.endsWith('.d.ts'))]).stdout
      .split('\n').filter(line => /from ["']mongoose["']/.test(line)).length;
  }
  writeJson(join(out, 'archives.json'), manifest);

  // Search register: every textual hit, classified by hand in the design doc.
  const searches = {
    'symbols': ['mongoose|ModelStore|ModelDef|DatabaseCtx|requireModels|initDatabase|BootstrapFn', 'packages', 'example', 'scripts', 'docs'],
    'conventions': ['MONGO_URI|modelFiles|bootstrapFiles|registerBasePlugins|handle\\.connection|ctx\\.models|\\.models!', 'packages/core/src', 'example', 'scripts'],
    'packages': ['mongoose|mongodb|bson|@tulipes/core/db', 'yarn.lock', 'packages', 'example'],
    'declarations': ['mongoose', 'packages/core/dist'],
  };
  const register = {};
  for (const [name, [pattern, ...paths]] of Object.entries(searches)) {
    // git grep: tracked files only, so node_modules never pollutes the register;
    // the emitted declarations are ignored files and need --no-index.
    const args = ['grep', '-n', '-I', '-E', ...(name === 'declarations' ? ['--no-index'] : []), pattern, '--', ...paths.filter(p => existsSync(join(repo, p)))];
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
    writeFileSync(join(out, `search-${name}.txt`), `$ git ${args.join(' ')}\n\n${lines.join('\n')}\n`);
    const byFile = {};
    for (const line of lines) { const file = line.split(':')[0]; byFile[file] = (byFile[file] ?? 0) + 1; }
    register[name] = { pattern, hits: lines.length, files: byFile };
  }
  writeJson(join(out, 'search.json'), register);
  console.log(`baseline recorded for ${sha} in ${relative(repo, out)}; archives packed`);
}

function lockEntries() {
  const lock = readFileSync(join(repo, 'yarn.lock'), 'utf8');
  const entries = {};
  for (const name of ['mongoose', 'mongodb', 'bson', 'mongodb-connection-string-url', '@mongodb-js/saslprep', 'kareem', 'mpath', 'mquery', 'sift']) {
    const match = lock.match(new RegExp(`^"${name.replace('/', '\\/')}@[^\\n]*":\\n  version: ([^\\n]+)`, 'm'));
    if (match) entries[name] = match[1];
  }
  return entries;
}

function redact(url) { try { const u = new URL(url); u.password = u.password ? '***' : ''; return u.href; } catch { return '<unparseable>'; } }

// ───────────────────────────── fixtures ─────────────────────────────────

const FIXTURES = {
  A: { title: 'Core package only', build: buildCoreOnly },
  B: { title: 'Minimal starter', build: root => buildStarter(root, 'minimal') },
  C: { title: 'Production starter', build: root => buildStarter(root, 'production'), needsServices: true },
  D: { title: 'CLI launcher', build: buildLauncher },
};

function artifactResolutions() {
  const manifest = readJson(join(artifactsDir, 'manifest.json'));
  run(process.execPath, [join(repo, 'scripts/artifacts.mjs'), 'verify', artifactsDir]);
  return Object.fromEntries(manifest.packages.map(pkg => [pkg.name, 'file:' + join(artifactsDir, pkg.file)]));
}

function writeManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
}

/** A: only the packed core plus what importing it needs (nothing else). */
function buildCoreOnly(root) {
  const resolutions = artifactResolutions();
  writeManifest(root, { name: 'fixture-a', private: true, type: 'module', packageManager: 'yarn@4.18.0', dependencies: { '@tulipes/core': resolutions['@tulipes/core'] } });
  return { app: root, hasApp: false };
}

/** D: the smoke launcher — CLI installed with every archive, no app. */
function buildLauncher(root) {
  const resolutions = artifactResolutions();
  writeManifest(root, { name: 'fixture-d', private: true, packageManager: 'yarn@4.18.0', dependencies: resolutions, resolutions });
  return { app: root, hasApp: false };
}

/** B/C: generated by the packed CLI, then pinned to the same archives. */
function buildStarter(root, preset) {
  const resolutions = artifactResolutions();
  const cli = join(root, 'cli');
  // Pin every archive for the launcher too: the CLI depends on a core range the
  // registry may not serve yet (or quarantines by age).
  writeManifest(cli, { private: true, packageManager: 'yarn@4.18.0', dependencies: resolutions, resolutions });
  run('yarn', ['install'], { cwd: cli, env: yarnEnv(join(root, 'cache-cli')), log: join(root, 'cli-install.log') });
  const bin = join(cli, 'node_modules/@tulipes/cli/dist/bin.js');
  const app = join(root, 'app');
  run(process.execPath, [bin, 'init', app, '--preset', preset], { cwd: root, env: cleanEnv(), log: join(root, 'init.log') });
  const pkgFile = join(app, 'package.json');
  const pkg = readJson(pkgFile);
  pkg.resolutions = { ...pkg.resolutions, ...resolutions };
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  return { app, hasApp: true, bin, preset };
}

// ─────────────────────────── install shapes ─────────────────────────────

function install(keys) {
  const results = {};
  for (const key of keys) {
    const fixture = FIXTURES[key];
    if (!fixture) throw new Error(`Unknown fixture ${key}`);
    const root = join(fixturesRoot, key);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    console.log(`fixture ${key} — ${fixture.title}`);
    const built = fixture.build(root);
    const cache = join(root, 'cache');
    const timings = { fresh: [], warm: [] };
    for (let i = 0; i < INSTALL_RUNS; i++) {
      rmSync(cache, { recursive: true, force: true });
      rmSync(join(built.app, 'node_modules'), { recursive: true, force: true });
      timings.fresh.push(run('yarn', ['install'], { cwd: built.app, env: yarnEnv(cache), log: join(root, `install-fresh-${i + 1}.log`) }).ms);
      rmSync(join(built.app, 'node_modules'), { recursive: true, force: true });
      timings.warm.push(run('yarn', ['install'], { cwd: built.app, env: yarnEnv(cache), log: join(root, `install-warm-${i + 1}.log`) }).ms);
    }
    // Retain the exact manifests/lockfiles the numbers describe.
    const keep = join(out, 'fixtures', key);
    mkdirSync(keep, { recursive: true });
    for (const file of ['package.json', 'yarn.lock']) if (existsSync(join(built.app, file))) writeFileSync(join(keep, file), readFileSync(join(built.app, file)));
    if (built.hasApp) for (const dir of readdirSync(join(built.app, 'modules'))) {
      const manifest = join(built.app, 'modules', dir, 'package.json');
      if (existsSync(manifest)) { mkdirSync(join(keep, 'modules', dir), { recursive: true }); writeFileSync(join(keep, 'modules', dir, 'package.json'), readFileSync(manifest)); }
    }

    const installed = inventory(join(built.app, 'node_modules'));
    const why = spawnSync('yarn', ['why', 'mongoose', '-R'], { cwd: built.app, env: yarnEnv(cache), encoding: 'utf8' });
    writeFileSync(join(root, 'why-mongoose.log'), (why.stdout ?? '') + (why.stderr ?? ''));
    results[key] = {
      title: fixture.title,
      root, app: built.app,
      install_ms: timings,
      installed,
      mongoose_graph: dependencyGraph(join(built.app, 'node_modules'), 'mongoose'),
      graphs: Object.fromEntries(GRAPH_ROOTS.map(root => [root, dependencyGraph(join(built.app, 'node_modules'), root)])),
      resolve: resolveOutcomes(built.app, root),
      du_kb: Number(spawnSync('du', ['-sk', join(built.app, 'node_modules')], { encoding: 'utf8' }).stdout.split('\t')[0]) || null,
    };
    writeJson(join(out, 'install.json'), { ...(existsSync(join(out, 'install.json')) ? readJson(join(out, 'install.json')) : {}), ...results });
    console.log(`  ${installed.unique.length} unique packages, ${installed.copies} physical copies, ${(installed.bytes / 1024 / 1024).toFixed(1)} MiB; ${GRAPH_ROOTS.map(root => `${root} ${results[key].graphs[root].present ? 'present' : 'absent'}`).join(', ')}`);
  }
}

/** Walk node_modules: every package.json is one physical copy. */
function inventory(dir) {
  const copies = [];
  let bytes = 0, files = 0;
  const walk = (path, scopeDepth) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full, scopeDepth); continue; }
      files++; bytes += statSync(full).size;
      if (entry.name === 'package.json' && isPackageRoot(full)) {
        try { const pkg = readJson(full); if (pkg.name && pkg.version) copies.push({ name: pkg.name, version: pkg.version, path: relative(dir, path) }); } catch {}
      }
    }
  };
  if (existsSync(dir)) walk(dir, 0);
  const unique = [...new Set(copies.map(c => `${c.name}@${c.version}`))].sort();
  const duplicated = Object.entries(copies.reduce((acc, c) => { (acc[c.name] ??= new Set()).add(c.version); return acc; }, {})).filter(([, v]) => v.size > 1).map(([name, v]) => ({ name, versions: [...v] }));
  return { bytes, files, copies: copies.length, unique, duplicated, copy_list: copies };
}

/** node_modules/<name>/package.json or node_modules/@scope/<name>/package.json only. */
function isPackageRoot(file) {
  const parts = file.split('/');
  const i = parts.lastIndexOf('node_modules');
  const depth = parts.length - 1 - i;
  return depth === 2 || (depth === 3 && parts[i + 1].startsWith('@'));
}

/** Roots whose reachable graphs are attributed separately: the extracted drivers. */
const GRAPH_ROOTS = ['mongoose', 'bullmq', 'ioredis', 'socket.io', 'tsx', 'node-gyp', 'express', 'i18next', 'i18next-fs-backend', 'zod', 'dotenv', 'colorette', 'typescript', 'vitest', 'vite', '@tulipes/spec'];

/** Dependencies reachable from one root package, resolved the way Node would. */
function dependencyGraph(modulesDir, root) {
  const start = join(modulesDir, root, 'package.json');
  if (!existsSync(start)) return { present: false };
  const seen = new Map();
  const queue = [[root, join(modulesDir, root)]];
  while (queue.length) {
    const [name, dir] = queue.shift();
    if (seen.has(name)) continue;
    const pkg = readJson(join(dir, 'package.json'));
    seen.set(name, { version: pkg.version, bytes: dirBytes(dir), path: relative(modulesDir, dir) });
    // Optional dependencies count when installed: esbuild's platform binary is one.
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      // Nested copy first, then hoisted — the same lookup order as require().
      const nested = join(dir, 'node_modules', dep), hoisted = join(modulesDir, dep);
      if (existsSync(nested)) queue.push([dep, nested]); else if (existsSync(hoisted)) queue.push([dep, hoisted]);
    }
  }
  // Attribute shared packages: anything in the graph that a non-graph package
  // also depends on would survive extraction and must not be counted as saved.
  for (const copy of inventory(modulesDir).copy_list) {
    if (seen.has(copy.name) || copy.name.startsWith('@tulipes/')) continue; // the framework packages are the coupling under study, not sharers
    const pkg = readJson(join(modulesDir, copy.path, 'package.json'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) if (seen.has(dep)) (seen.get(dep).shared_with ??= []).push(copy.name);
  }
  const exclusive = [...seen.values()].filter(v => !v.shared_with);
  return { present: true, packages: Object.fromEntries(seen), count: seen.size, bytes: [...seen.values()].reduce((sum, v) => sum + v.bytes, 0), exclusive_count: exclusive.length, exclusive_bytes: exclusive.reduce((sum, v) => sum + v.bytes, 0) };
}

function dirBytes(dir) {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') bytes += dirBytes(full); } else bytes += statSync(full).size;
  }
  return bytes;
}

/** Can the app, and can core itself, resolve the driver packages? */
function resolveOutcomes(app, root) {
  const probe = `
    import { createRequire } from 'node:module';
    const targets = ['mongoose', 'mongodb', 'bson', 'bullmq', 'ioredis', 'socket.io', '@tulipes/core', '@tulipes/core/db', '@tulipes/core/boot'];
    const from = (label, anchor) => [label, Object.fromEntries(targets.map(t => { try { return [t, createRequire(anchor).resolve(t)]; } catch (e) { return [t, null]; } }))];
    const result = Object.fromEntries([
      from('app', process.argv[1]),
      from('core', createRequire(process.argv[1]).resolve('@tulipes/core')),
    ]);
    console.log(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, join(app, 'package.json')], { cwd: app, env: cleanEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error('resolve probe failed: ' + result.stderr);
  const parsed = JSON.parse(result.stdout);
  for (const scope of Object.values(parsed)) for (const [k, v] of Object.entries(scope)) scope[k] = v ? relative(root, v) : null;
  return parsed;
}

// ───────────────────────────── startup ──────────────────────────────────

function productionServices() {
  if (!process.env.TEST_MONGO_URI || !process.env.TEST_REDIS_URL) return null;
  const mongo = new URL(process.env.TEST_MONGO_URI);
  mongo.pathname = '/tulipes_s09_' + randomBytes(6).toString('hex');
  return { mongo: mongo.href, redis: process.env.TEST_REDIS_URL };
}

function appEnv(key, services) {
  const env = cleanEnv({ APP_ENV: 'production', LOG_FILE: 'false', LOG_CONSOLE: 'false' });
  if (key === 'C') Object.assign(env, {
    MONGO_URI: services.mongo, REDIS_URL: services.redis,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    AUTH_ADMIN_EMAIL: 's09@example.test', AUTH_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
  });
  return env;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return sorted.length ? { count: sorted.length, min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted.at(-1) } : { count: 0 };
}

const fmt = ms => ms == null ? '—' : `${ms.toFixed(0)}ms`;

/** Fresh node process; time from before dynamic import to resolution. */
function importTiming(app, specifier, nodeArgs = []) {
  const probe = `const t0 = performance.now(); await import(${JSON.stringify(specifier)}); console.log(JSON.stringify({ ms: performance.now() - t0, process_ms: performance.now() }));`;
  const result = spawnSync(process.execPath, [...nodeArgs, '--input-type=module', '-e', probe], { cwd: app, env: cleanEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

/** CLI spawn → deterministic documents written, connections denied. */
function offlineTiming(app, bin, env) {
  const guard = join(app, 's09-offline-guard.mjs');
  if (!existsSync(guard)) writeFileSync(guard, `import { Socket } from 'node:net';\nSocket.prototype.connect = function () { throw new Error('Offline inspection attempted a network connection'); };\n`);
  const offline = { ...env, MONGO_URI: 'invalid', REDIS_URL: 'invalid', JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '', AUTH_ADMIN_PASSWORD: '' };
  const t0 = performance.now();
  const result = spawnSync(process.execPath, ['--import', guard, bin, 'spec', '--offline', '--openapi', 's09/openapi.json', '--postman', 's09/collection.json'], { cwd: app, env: offline, encoding: 'utf8' });
  const ms = performance.now() - t0;
  if (result.status !== 0) throw new Error(result.stderr);
  return { ms };
}

function rss(pid) { const r = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }); return Number(r.stdout.trim()) || undefined; }

// ───────────────────────────── summary ──────────────────────────────────

function summary() {
  const lines = [`# S09 inventory — ${sha}`, ''];
  if (existsSync(join(out, 'archives.json'))) {
    lines.push('## Archives', '', '| Package | Version | Archive bytes | Unpacked bytes | Files | `.d.ts` lines importing mongoose | Integrity |', '|---|---|---|---|---|---|---|');
    for (const p of readJson(join(out, 'archives.json')).packages) lines.push(`| ${p.name} | ${p.version} | ${p.archive_bytes} | ${p.unpacked_bytes} | ${p.files} | ${p.dts_mongoose} | \`${p.integrity.slice(0, 24)}…\` |`);
    lines.push('');
  }
  if (existsSync(join(out, 'install.json'))) {
    const install = readJson(join(out, 'install.json'));
    lines.push('## Installation shapes', '', '| Fixture | Unique name@version | Physical copies | Duplicated names | Installed bytes | `du -sk` KiB | Mongoose graph pkgs / bytes (exclusive) | mongoose resolvable from app / core | Fresh install ms | Warm install ms |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [key, r] of Object.entries(install)) {
      const g = r.mongoose_graph.present ? `${r.mongoose_graph.count} / ${r.mongoose_graph.bytes} (${r.mongoose_graph.exclusive_count} / ${r.mongoose_graph.exclusive_bytes})` : 'absent';
      lines.push(`| ${key} — ${r.title} | ${r.installed.unique.length} | ${r.installed.copies} | ${r.installed.duplicated.length} | ${r.installed.bytes} | ${r.du_kb ?? '—'} | ${g} | ${r.resolve.app.mongoose ? 'yes' : 'no'} / ${r.resolve.core.mongoose ? 'yes' : 'no'} | ${r.install_ms.fresh.map(v => v.toFixed(0)).join(', ')} | ${r.install_ms.warm.map(v => v.toFixed(0)).join(', ')} |`);
    }
    lines.push('', '## Driver graphs (pkgs / bytes, exclusive in parentheses)', '', `| Fixture | ${GRAPH_ROOTS.join(' | ')} |`, `|---|${GRAPH_ROOTS.map(() => '---').join('|')}|`);
    for (const [key, r] of Object.entries(install)) lines.push(`| ${key} | ${GRAPH_ROOTS.map(root => { const g = r.graphs?.[root]; return !g ? '—' : g.present ? `${g.count} / ${g.bytes} (${g.exclusive_count} / ${g.exclusive_bytes})` : 'absent'; }).join(' | ')} |`);
    lines.push('');
    for (const [key, r] of Object.entries(install)) if (r.installed.duplicated.length) lines.push(`- ${key}: duplicated ${r.installed.duplicated.map(d => `${d.name} (${d.versions.join(', ')})`).join('; ')}`);
    lines.push('');
  }
  if (existsSync(join(out, 'startup.json'))) {
    lines.push('## Startup', '', '| Fixture | Scenario | n | Median | p95 | Range | Failures | RSS at readiness (median KiB) | Shutdown median |', '|---|---|---|---|---|---|---|---|---|');
    for (const [key, r] of Object.entries(readJson(join(out, 'startup.json')))) {
      if (r.status !== 'measured') { lines.push(`| ${key} — ${r.title} | — | — | — | — | — | not measured: ${r.reason} | — | — |`); continue; }
      for (const [name, s] of Object.entries(r.scenarios)) lines.push(`| ${key} — ${r.title} | ${name} | ${s.stats.count} | ${fmt(s.stats.median)} | ${fmt(s.stats.p95)} | ${fmt(s.stats.min)}–${fmt(s.stats.max)} | ${s.failures} | ${s.rss ? s.rss.median : '—'} | ${s.shutdown ? fmt(s.shutdown.median) : '—'} |`);
    }
    lines.push('');
  }
  const file = join(out, 'summary.md');
  writeFileSync(file, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nwritten to ${relative(repo, file)}`);
}

// ─────────────────────────────── main ───────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try {
  const [action, ...rest] = process.argv.slice(2);
  const keys = rest.length ? rest.map(k => k.toUpperCase()) : ['A', 'B', 'C', 'D'];
  if (action === 'baseline') baseline();
  else if (action === 'install') install(keys);
  else if (action === 'startup') await startup(keys.filter(k => k !== 'D'));
  else if (action === 'summary') summary();
  else if (action === 'clean') { rmSync(fixturesRoot, { recursive: true, force: true }); console.log('removed ' + fixturesRoot); }
  else throw new Error('Usage: node scripts/s09-inventory.mjs baseline|install|startup|summary|clean [fixtures…]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

/** Import, offline description, backend/worker readiness and shutdown per fixture. */
async function startup(keys) {
  const previous = existsSync(join(out, 'startup.json')) ? readJson(join(out, 'startup.json')) : {};
  const installs = existsSync(join(out, 'install.json')) ? readJson(join(out, 'install.json')) : {};
  for (const key of keys) {
    const fixture = FIXTURES[key];
    const record = installs[key];
    if (!record || !existsSync(join(record.app, 'node_modules'))) throw new Error(`Fixture ${key} is not installed; run install ${key} first`);
    const services = key === 'C' ? productionServices() : null;
    if (fixture.needsServices && !services) {
      previous[key] = { title: fixture.title, status: 'not measured', reason: 'TEST_MONGO_URI and TEST_REDIS_URL are required' };
      writeJson(join(out, 'startup.json'), previous);
      console.log(`fixture ${key}: not measured (no dedicated services)`);
      continue;
    }
    console.log(`fixture ${key} — startup`);
    const scenarios = {};
    scenarios.import_root = await timed(async () => importTiming(record.app, '@tulipes/core'));
    scenarios.import_boot = await timed(async () => importTiming(record.app, '@tulipes/core/boot'));
    // Attribution only: the driver's own import cost (where it is installed at all), and the tsx loader's.
    if (record.resolve.app.mongoose) scenarios.import_mongoose = await timed(async () => importTiming(record.app, 'mongoose'));
    if (record.root && existsSync(join(record.root, 'cli'))) {
      scenarios.import_boot_tsx = await timed(async () => importTiming(record.app, '@tulipes/core/boot', ['--import', 'tsx']));
      const bin = join(record.root, 'cli/node_modules/@tulipes/cli/dist/bin.js');
      const env = appEnv(key, services);
      scenarios.offline_spec = await timed(async () => offlineTiming(record.app, bin, env));
      scenarios.backend_readiness = await timed(() => spawnUntil(process.execPath, ['--import', 'tsx', 'app.ts'], { cwd: record.app, env: { ...env, PORT: '0' } }, readyByBanner(key === 'C' ? ['/api/v1/hello'] : ['/health', '/api/v1/hello'])));
      if (key === 'C') scenarios.worker_readiness = await timed(() => spawnUntil(process.execPath, ['--import', 'tsx', 'worker.ts'], { cwd: record.app, env: { ...env, PROCESS_MODE: 'worker' } }, async output => /consuming \d+ queue/.test(output)));
    }
    previous[key] = { title: fixture.title, status: 'measured', services: services ? { mongo: redact(services.mongo), redis: redact(services.redis) } : null, scenarios };
    writeJson(join(out, 'startup.json'), previous);
    for (const [name, s] of Object.entries(scenarios)) console.log(`  ${name}: median ${fmt(s.stats.median)} p95 ${fmt(s.stats.p95)} range ${fmt(s.stats.min)}–${fmt(s.stats.max)} (n=${s.stats.count}, failures ${s.failures})`);
  }
}

/** First run, warm-ups, then samples; every sample retained, including failures. */
async function timed(sample) {
  const first = await sample();
  for (let i = 0; i < WARMUPS; i++) await sample();
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) { try { samples.push(await sample()); } catch (error) { samples.push({ error: error.message }); } }
  const ok = samples.filter(s => !s.error);
  return { first, samples, stats: stats(ok.map(s => s.ms)), failures: samples.length - ok.length, rss: ok.some(s => s.rss_kb) ? stats(ok.map(s => s.rss_kb ?? 0)) : undefined, shutdown: ok.some(s => s.shutdown_ms != null) ? stats(ok.map(s => s.shutdown_ms)) : undefined };
}

/** The banner prints the bound port; readiness is the first 200 on every path. */
function readyByBanner(paths) {
  return async output => {
    const match = output.match(/http:\/\/localhost:(\d+)/);
    if (!match) return false;
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${match[1]}${path}`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
      if (!response || response.status !== 200) return false;
    }
    return true;
  };
}

async function spawnUntil(command, args, options, ready) {
  const t0 = performance.now();
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  let ms, rss_kb;
  const deadline = t0 + 60_000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`process exited early (${child.exitCode}):\n${output.slice(-2000)}`);
    if (await ready(output)) { ms = performance.now() - t0; rss_kb = rss(child.pid); break; }
    await new Promise(r => setTimeout(r, 15));
  }
  if (ms == null) { child.kill('SIGKILL'); await exited; throw new Error('readiness timeout:\n' + output.slice(-2000)); }
  const t1 = performance.now();
  child.kill('SIGTERM');
  const code = await exited;
  return { ms, rss_kb, shutdown_ms: performance.now() - t1, exit_code: code };
}
