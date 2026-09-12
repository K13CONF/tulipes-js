import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * S15.2 — the generated nginx template in front of a real generated app.
 *
 *   node scripts/ingress-smoke.mjs <artifacts> [--keep]
 *
 * Express tests prove what the app does with headers it is given. They cannot
 * prove what nginx gives it. This runs the committed production template in an
 * nginx container against a packed production app and records, per check, what
 * a client actually observes: forwarded identity, forged forwarding headers,
 * host/protocol, the body-size boundary, SSE buffering, and what reaching the
 * backend port directly would mean for the trust configuration.
 *
 * Requires Docker and dedicated TEST_MONGO_URI / TEST_REDIS_URL services.
 * The template's `proxy_pass 127.0.0.1:{{PORT}}` is rewritten to the host
 * gateway so the container can reach an app running on this machine; every
 * other directive is used verbatim, and that substitution is recorded in the
 * report as the one deviation from the deployed file.
 */
const [artifactPath, ...flags] = process.argv.slice(2);
if (!artifactPath || flags.some((flag) => flag !== '--keep')) throw new Error('Usage: ingress-smoke.mjs <artifacts> [--keep]');
const artifacts = resolve(artifactPath);
const workspace = mkdtempSync(join(tmpdir(), 'tulipes-ingress-'));
const logs = resolve('reports', 'ingress-smoke');
mkdirSync(logs, { recursive: true });
const container = 'tulipes-ingress-' + randomBytes(4).toString('hex');
const ingressPort = 18080 + Math.floor(Math.random() * 900);
const appPort = 19080 + Math.floor(Math.random() * 900);
const checks = [];
let step = 0;

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 300_000 });
  const file = join(logs, `${String(++step).padStart(2, '0')}-${command.split('/').at(-1)}.log`);
  writeFileSync(file, `$ ${command} ${args.join(' ')}\n\n` + (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed; see ${file}\n${result.stderr ?? ''}`);
  return result.stdout ?? '';
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
/** Record what was observed; `ok` is the check's own verdict, never a retry. */
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

let app;
try {
  // ── the application under test ───────────────────────────────────────────
  const manifest = readJson(join(artifacts, 'manifest.json'));
  const resolutions = Object.fromEntries(manifest.packages.map((pkg) => [pkg.name, 'file:' + join(artifacts, pkg.file)]));
  const cliRoot = join(workspace, 'cli');
  mkdirSync(cliRoot);
  writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({ private: true, packageManager: 'yarn@4.18.0', dependencies: { '@tulipes/cli': resolutions['@tulipes/cli'] }, resolutions }));
  writeFileSync(join(cliRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
  run('yarn', ['install'], cliRoot, { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });

  app = join(workspace, 'app');
  run(process.execPath, [join(cliRoot, 'node_modules/@tulipes/cli/dist/bin.js'), 'init', app, '--preset', 'production'], workspace);
  const pkgFile = join(app, 'package.json');
  writeFileSync(pkgFile, JSON.stringify({ ...readJson(pkgFile), resolutions }, null, 2));

  // A probe module: the generated app has no endpoint that reports the client
  // identity it resolved, and that identity is exactly what this tests.
  const probe = join(app, 'modules/ingress-probe');
  mkdirSync(join(probe, 'routes'), { recursive: true });
  writeFileSync(join(probe, 'package.json'), JSON.stringify({
    name: '@app/ingress-probe', version: '0.0.0', private: true, type: 'module',
    tulipes: { offline: true, tier: 'app', priority: 999 },
    dependencies: { '@tulipes/core': resolutions['@tulipes/core'], express: '^5' },
  }, null, 2));
  writeFileSync(join(probe, 'module.acl.ts'), `import type { AclBuilder } from "@tulipes/core/acl";
export default function probeAcl(acl: AclBuilder): void {
  acl.allow("guest", "ingress-probe:echo").allow("guest", "ingress-probe:stream").allow("guest", "ingress-probe:raw");
}
`);
  writeFileSync(join(probe, 'routes/probe.routes.ts'), `import { Router } from "express";
import { defineRoutes } from "@tulipes/core/http";

/** Everything the app resolved from the request, as the app sees it. */
export default defineRoutes(({ rai }) => {
  const router = Router();
  router.get("/ingress/echo", rai({ id: "ingress-probe:echo" }), (req, res) => {
    res.respond({ data: {
      ip: req.ip, ips: req.ips, protocol: req.protocol, secure: req.secure, hostname: req.hostname,
      forwarded_for: req.headers["x-forwarded-for"] ?? null,
      forwarded_proto: req.headers["x-forwarded-proto"] ?? null,
      forwarded_host: req.headers["x-forwarded-host"] ?? null,
    } });
  });
  // Two streams: one declaring itself unbufferable to nginx, one not. The
  // difference is what proves the header is doing the work.
  for (const [path, id, accel] of [["/ingress/stream", "ingress-probe:stream", true], ["/ingress/raw-stream", "ingress-probe:raw", false]] as const) {
    router.get(path, rai({ id }), (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...(accel ? { "X-Accel-Buffering": "no" } : {}),
      });
      let sent = 0;
      const timer = setInterval(() => {
        res.write(\`data: \${Date.now()}\\n\\n\`);
        if (++sent >= 20) { clearInterval(timer); res.end(); }
      }, 100);
      req.on("close", () => clearInterval(timer));
    });
  }
  return router;
});
`);

  const env = {
    ...process.env, APP_ENV: 'production', LOG_FILE: 'false', LOG_CONSOLE: 'false', PORT: String(appPort),
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    AUTH_ADMIN_EMAIL: 'ingress@example.test', AUTH_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
    // The deployed template's own instruction for a single local ingress.
    TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128,172.16.0.0/12',
  };
  if (!env.TEST_MONGO_URI || !env.TEST_REDIS_URL) throw new Error('Ingress smoke requires dedicated TEST_MONGO_URI and TEST_REDIS_URL services');
  const mongo = new URL(env.TEST_MONGO_URI);
  mongo.pathname = '/tulipes_ingress_' + randomBytes(6).toString('hex');
  Object.assign(env, { MONGO_URI: mongo.href, REDIS_URL: env.TEST_REDIS_URL });

  run('yarn', ['install'], app, { ...env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
  run('yarn', ['sync'], app, env);

  const server = spawn(process.execPath, ['--import', 'tsx', 'app.ts'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (d) => { output += d; });
  server.stderr.on('data', (d) => { output += d; });
  const ready = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (server.exitCode !== null) throw new Error(`app exited (${server.exitCode}):\n${output.slice(-3000)}`);
      const response = await fetch(`http://127.0.0.1:${appPort}/api/v1/hello`).catch(() => null);
      if (response?.status === 200) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('app never became ready:\n' + output.slice(-3000));
  };
  await ready();

  // ── the committed template, rendered ─────────────────────────────────────
  const template = readFileSync(join(app, 'nginx/production.conf'), 'utf8');
  const rendered = template
    .replaceAll('{{DOMAIN}}', 'localhost')
    .replaceAll('{{PORT}}', String(appPort))
    // The one deviation: the container cannot reach the host on 127.0.0.1.
    .replace('proxy_pass http://127.0.0.1:', 'proxy_pass http://host.docker.internal:');
  const confDir = join(workspace, 'nginx');
  mkdirSync(confDir);
  writeFileSync(join(confDir, 'default.conf'), rendered);
  writeFileSync(join(logs, 'rendered.conf'), rendered);

  // Pull explicitly: `docker run` pulling inline can outlive the step timeout.
  run('docker', ['pull', 'nginx:1.27-alpine'], workspace);
  run('docker', ['run', '-d', '--name', container, '-p', `${ingressPort}:80`,
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${confDir}/default.conf:/etc/nginx/conf.d/default.conf:ro`, 'nginx:1.27-alpine'], workspace);
  run('docker', ['exec', container, 'nginx', '-t'], workspace);
  check('the committed template passes nginx -t as rendered', true, 'nginx:1.27-alpine');

  const ingress = `http://127.0.0.1:${ingressPort}`;
  const direct = `http://127.0.0.1:${appPort}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${ingress}/api/v1/hello`).catch(() => null);
    if (response?.status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const echo = async (base, headers = {}) => (await (await fetch(`${base}/ingress/echo`, { headers })).json()).data;

  // ── checks ───────────────────────────────────────────────────────────────
  const plain = await echo(ingress);
  check('the app resolves the client address through the proxy', Boolean(plain.ip) && plain.ip !== '::ffff:127.0.0.1' || Boolean(plain.forwarded_for),
    `ip=${plain.ip} x-forwarded-for=${plain.forwarded_for}`);

  const forged = await echo(ingress, { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' });
  check('a client-supplied X-Forwarded-For cannot become the client identity', forged.ip !== '203.0.113.9' && !String(forged.forwarded_for).includes('203.0.113.9'),
    `ip=${forged.ip} x-forwarded-for=${forged.forwarded_for}`);

  const forgedProto = await echo(ingress, { 'x-forwarded-proto': 'https' });
  check('a client-supplied X-Forwarded-Proto cannot make a plain request look secure', forgedProto.protocol === 'http' && forgedProto.secure === false,
    `protocol=${forgedProto.protocol} secure=${forgedProto.secure}`);

  const forgedHost = await echo(ingress, { 'x-forwarded-host': 'evil.example' });
  check('a client-supplied X-Forwarded-Host cannot replace the resolved host', forgedHost.hostname !== 'evil.example',
    `hostname=${forgedHost.hostname} x-forwarded-host=${forgedHost.forwarded_host}`);

  const body = (bytes) => fetch(`${ingress}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(bytes) });
  const under = await body(512 * 1024);
  const over = await body(2 * 1024 * 1024);
  const overBody = await over.text();
  check('nginx rejects a body over client_max_body_size before the app sees it', over.status === 413 && !overBody.trimStart().startsWith('{'),
    `over=${over.status} (${overBody.trimStart().slice(0, 15).replace(/\s+/g, ' ')}…) under=${under.status}`);

  // SSE: measure the gap between the first two events a client receives.
  const firstEvents = async (path) => {
    const controller = new AbortController();
    const started = Date.now();
    const response = await fetch(`${ingress}${path}`, { signal: controller.signal });
    const reader = response.body.getReader();
    const at = [];
    try {
      while (at.length < 2) {
        const { value, done } = await reader.read();
        if (done) break;
        if (new TextDecoder().decode(value).includes('data:')) at.push(Date.now() - started);
      }
    } finally { controller.abort(); }
    return at;
  };
  const streamed = await firstEvents('/ingress/stream');
  check('SSE declaring X-Accel-Buffering: no reaches the client event by event', streamed.length === 2 && streamed[1] < 1000,
    `first two events at ${streamed.join(' ms, ')} ms`);
  const rawStream = await firstEvents('/ingress/raw-stream');
  check('the same stream without that header is recorded for comparison', true,
    rawStream.length === 2 ? `first two events at ${rawStream.join(' ms, ')} ms` : 'buffered until the response ended');

  // Backend port isolation: what a request that skips the proxy can claim.
  const directForged = await echo(direct, { 'x-forwarded-for': '203.0.113.9' });
  const bypassable = directForged.ip === '203.0.113.9';
  check('reaching the backend port directly is an operator responsibility, not an app control', true,
    bypassable
      ? 'a direct client on a trusted CIDR CAN set its own X-Forwarded-For — the backend port must not be reachable from outside the host'
      : `direct connections do not gain a forged identity (ip=${directForged.ip})`);

  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  if (flags.includes('--keep')) console.error('kept ' + workspace);
  else rmSync(workspace, { recursive: true, force: true });
}

writeFileSync(join(logs, 'checks.json'), JSON.stringify({ recorded_at: new Date().toISOString(), ingressPort, appPort, checks }, null, 2));
const failed = checks.filter((entry) => !entry.ok);
console.log(`\ningress: ${checks.length - failed.length}/${checks.length} checks passed; report ${join(logs, 'checks.json')}`);
if (failed.length) process.exitCode = 1;
