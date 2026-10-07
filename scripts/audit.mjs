import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Retain every finding; fail on high/critical or an unsuccessful audit request.
// `--environment production` is accepted for the workflow's sake and becomes pnpm's --prod.
const output = resolve(process.argv[2] ?? 'reports/audit.jsonl');
const extra = process.argv.slice(3);
const environment = extra.indexOf('--environment');
const args = extra.filter((_, index) => index !== environment && index !== environment + 1);
if (environment !== -1 && extra[environment + 1] === 'production') args.push('--prod');
const result = spawnSync('pnpm', ['audit', '--json', ...args], { encoding: 'utf8', timeout: 60_000 });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, (result.stdout ?? '') + (result.stderr ?? ''));
let blocked = false;
try {
  // pnpm audit prints one npm-audit document: advisories keyed by id, plus
  // metadata whenever the registry answered. An advisory ignored through
  // pnpm.auditConfig is left out of the advisories but still counted in the
  // metadata and the exit status, so the document decides, not the status.
  const report = JSON.parse(result.stdout ?? '');
  if (!report?.metadata || typeof report.advisories !== 'object' || report.advisories === null) blocked = true;
  else {
    for (const advisory of Object.values(report.muted ?? [])) {
      console.log(`muted by pnpm.auditConfig: ${advisory.module_name ?? advisory.id} — ${advisory.title ?? ''}`);
    }
  }
  if (!blocked) for (const advisory of Object.values(report.advisories)) {
    console.log(`${advisory.severity}: ${advisory.module_name} — ${advisory.title}`);
    if (advisory.severity === 'high' || advisory.severity === 'critical') blocked = true;
  }
} catch { blocked = true; }
if (result.error || ![0, 1].includes(result.status) || blocked) {
  console.error('Dependency audit failed; inspect ' + output);
  process.exitCode = 1;
} else console.log('Dependency audit has no high/critical findings; report: ' + output);
