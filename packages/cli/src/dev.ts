import { spawn } from "node:child_process";

import { runSync } from "./sync.ts";
import { requireNativeTypeScript } from "./app-core.ts";

/**
 * `tulipes dev [entry]` — sync first (generated types must never be stale
 * when the dev server starts), then run the entrypoint with node itself in
 * watch mode. Node strips the types natively, so there is no loader to
 * resolve and nothing to transpile: what runs in development is what PM2
 * runs in production.
 */
export async function runDev(rootDir: string, entry: string): Promise<void> {
  requireNativeTypeScript();
  await runSync(rootDir);

  const child = spawn(
    process.execPath,
    ["--watch", "--watch-preserve-output", entry],
    // `tulipes dev` is development by definition; say so, so the app reveals
    // internals and accepts the development placeholders.
    { cwd: rootDir, stdio: "inherit", env: { ...process.env, APP_ENV: process.env.APP_ENV ?? "development" } },
  );
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
