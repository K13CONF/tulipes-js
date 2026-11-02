import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("artifact verification rejects changed archives before any publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "tulipes-artifacts-"));

  try {
    await writeFile(join(root, "core.tgz"), "tampered archive");

    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        commit: "fixture",
        packages: [
          {
            name: "@tulipes/core",
            version: "0.9.0",
            file: "core.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/spec",
            version: "0.2.0",
            file: "spec.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/mongoose",
            version: "0.1.0",
            file: "mongoose.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/bullmq",
            version: "0.1.0",
            file: "bullmq.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/socket.io",
            version: "0.1.0",
            file: "socket.io.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/mcp",
            version: "0.1.0",
            file: "mcp.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/testing",
            version: "0.1.0",
            file: "testing.tgz",
            integrity: "sha512-original",
          },
          {
            name: "@tulipes/cli",
            version: "0.1.0",
            file: "cli.tgz",
            integrity: "sha512-original",
          },
        ],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/artifacts.mjs"), "verify", root],
      { encoding: "utf8", env: { ...process.env, GITHUB_SHA: "fixture" } },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Archive digest mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication preflights every package and refuses a conflicting existing version", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import { distTag, publicationPlan } from ${JSON.stringify(new URL("../../../scripts/artifacts.mjs", import.meta.url).href)};
    assert.equal(distTag('0.14.0', '0.13.2'), 'latest');
    assert.equal(distTag('0.13.3', '0.14.0'), 'maintenance');
    assert.equal(distTag('0.14.0', '0.14.0'), 'latest');
    assert.equal(distTag('0.15.0-rc.1', '0.14.0'), 'next');
    assert.equal(distTag('0.1.0', undefined), 'latest');
    const packages = [{ name: '@tulipes/core', version: '0.9.0', integrity: 'core' }, { name: '@tulipes/spec', version: '0.3.0', integrity: 'spec' }];
    await assert.rejects(publicationPlan(packages, async pkg => pkg.name.endsWith('core') ? null : { dist: { integrity: 'different' } }), /Published bytes differ/);
    assert.deepEqual(await publicationPlan(packages, async pkg => pkg.name.endsWith('core') ? { dist: { integrity: 'core' } } : null), [packages[1]]);
    await assert.rejects(publicationPlan(packages, async () => { throw new Error('Registry unavailable'); }), /Registry unavailable/);
  `,
    ],
    { encoding: "utf8" },
  );

  expect(result.status, result.stdout + result.stderr).toBe(0);
});
