import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { runSync } from "./sync.js";

/**
 * `forgex dev [entry]` — sync first (generated types must never be stale
 * when the dev server starts), then hand off to tsx in watch mode.
 *
 * tsx is resolved from core's own dependencies rather than trusting PATH,
 * so the command works in any workspace layout.
 */
export async function runDev(rootDir: string, entry: string): Promise<void> {
  await runSync(rootDir);

  const require = createRequire(import.meta.url);
  const tsxPackage = require.resolve("tsx/package.json");
  const tsxCli = join(dirname(tsxPackage), "dist", "cli.mjs");

  const child = spawn(
    process.execPath,
    [tsxCli, "watch", "--clear-screen=false", entry],
    { cwd: rootDir, stdio: "inherit" },
  );
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
