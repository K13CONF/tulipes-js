import { Environment } from "../env/environment.js";
import { ForgexBootError } from "../errors/boot-error.js";

/**
 * `forgex env:check` — boot phases 1–3 and nothing else: validate the
 * current environment against every module's declared contract, print the
 * verdict, exit accordingly. Built for CI gates and deploy preflights.
 */
export async function runEnvCheck(rootDir: string): Promise<void> {
  let env;
  try {
    env = Environment.load({ rootDir });
  } catch (error) {
    if (error instanceof ForgexBootError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const snapshot = env.store.snapshot(); // secrets redacted
  const names = Object.keys(snapshot);
  console.log(`APP_ENV=${env.appEnv} — ${names.length} variable(s) resolved:`);
  for (const name of names) {
    console.log(`  ✔ ${name}=${String(snapshot[name])}`);
  }
}
