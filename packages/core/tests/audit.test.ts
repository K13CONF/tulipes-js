import { chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

// Fake the package-manager process boundary; exercise the real audit CLI policy.
test.each([
  { severity: "moderate", status: 1, expected: 0 },
  { severity: "high", status: 1, expected: 1 },
  { severity: "critical", status: 1, expected: 1 },
  { severity: "moderate", status: 2, expected: 1 },
  { severity: null, status: 1, expected: 1 },
])(
  "audit fails closed on findings/errors: %j",
  async ({ severity, status, expected }) => {
    const root = await mkdtemp(join(tmpdir(), "tulipes-audit-"));

    try {
      // pnpm audit's document: advisories keyed by id, or no advisories at all
      // when the request itself failed.
      const record = severity
        ? {
            advisories: {
              "1": { severity, module_name: "fixture", title: "fixture advisory" },
            },
          }
        : { error: { code: "ERR_PNPM_AUDIT", message: "Registry unavailable" } };

      await writeFile(
        join(root, "pnpm"),
        `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(record))}); process.exitCode = ${status};\n`,
      );

      await chmod(join(root, "pnpm"), 0o755);

      const result = spawnSync(
        process.execPath,
        [resolve("scripts/audit.mjs"), join(root, "report.jsonl")],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: root + ":" + process.env.PATH },
        },
      );

      expect(result.status, result.stdout + result.stderr).toBe(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
