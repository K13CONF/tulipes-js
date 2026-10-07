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
let findings = 0, blocked = false;
try {
  // pnpm audit prints one npm-audit document: advisories keyed by id.
  const report = JSON.parse(result.stdout ?? '');
  if (!report || typeof report.advisories !== 'object' || report.advisories === null) blocked = true;
  else for (const advisory of Object.values(report.advisories)) {
    findings++;
    console.log(`${advisory.severity}: ${advisory.module_name} — ${advisory.title}`);
    if (advisory.severity === 'high' || advisory.severity === 'critical') blocked = true;
  }
} catch { blocked = true; }
if (result.error || ![0, 1].includes(result.status) || (result.status !== 0 && findings === 0) || blocked) {
  console.error('Dependency audit failed; inspect ' + output);
  process.exitCode = 1;
} else console.log('Dependency audit has no high/critical findings; report: ' + output);
