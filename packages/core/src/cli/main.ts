import { runSync } from "./sync.js";
import { runEnvCheck } from "./env-check.js";
import { runNewModule } from "./new-module.js";
import { runDev } from "./dev.js";

/**
 * The `forgex` CLI. Deliberately dependency-free argument handling — four
 * commands don't justify a parser library.
 * All commands operate on the app in the current working directory.
 */
const HELP = `forgex — module-based express framework

Usage:
  forgex sync                 regenerate types/config.d.ts and .env.example
  forgex env:check            validate env against every meta.variables.json (CI-friendly)
  forgex new module <name>    scaffold a module under ./modules
  forgex dev [entry]          run with tsx in watch mode (default entry: app.ts), sync first
`;

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const rootDir = process.cwd();

  switch (command) {
    case "sync":
      return runSync(rootDir);
    case "env:check":
      return runEnvCheck(rootDir);
    case "new":
      if (rest[0] !== "module" || !rest[1]) {
        console.error('Usage: forgex new module <name>');
        process.exitCode = 2;
        return;
      }
      return runNewModule(rootDir, rest[1]);
    case "dev":
      return runDev(rootDir, rest[0] ?? "app.ts");
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command "${command}"\n\n${HELP}`);
      process.exitCode = 2;
  }
}
