import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Retain every finding; fail on high/critical or an unsuccessful audit request.
const output = resolve(process.argv[2] ?? 'reports/audit.jsonl');
const result = spawnSync('yarn', ['npm', 'audit', '--all', '--recursive', '--json', ...process.argv.slice(3)], { encoding: 'utf8', timeout: 60_000 });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, (result.stdout ?? '') + (result.stderr ?? ''));
let findings = 0, blocked = false;
try {
  for (const line of (result.stdout ?? '').split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    const severity = record.children?.Severity;
    if (severity) {
      findings++;
      console.log(`${severity}: ${record.value} — ${record.children.Issue}`);
      if (severity === 'high' || severity === 'critical') blocked = true;
    } else if (record.type === 'error') blocked = true;
  }
} catch { blocked = true; }
if (result.error || ![0, 1].includes(result.status) || (result.status !== 0 && findings === 0) || blocked) {
  console.error('Dependency audit failed; inspect ' + output);
  process.exitCode = 1;
} else console.log('Dependency audit has no high/critical findings; report: ' + output);
