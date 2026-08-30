import { runInit } from "./init.js";
import { runSync } from "./sync.js";
import { runEnvCheck } from "./env-check.js";
import { runNewModule } from "./new-module.js";
import { runDev } from "./dev.js";
import { runUpdate } from "./update.js";
import { coreVersion } from "./package-info.js";

/**
 * The `tulipes` CLI. Deliberately dependency-free argument handling — a
 * handful of commands don't justify a parser library.
 * All commands operate on the app in the current working directory.
 */
const HELP = `tulipes — module-based express framework

Usage:
  tulipes init [dir]           scaffold a new application (needs mongo + redis)
  tulipes dev [entry]          run with tsx in watch mode (default entry: app.ts), sync first
  tulipes sync                 regenerate types/config.d.ts and .env.example
  tulipes env:check            validate env against every meta.variables.json (CI-friendly)
  tulipes new module <name>    scaffold a module under ./modules
  tulipes update               upgrade @tulipes/core to the latest release, everywhere
  tulipes -v                   print the installed core version
`;

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const rootDir = process.cwd();

  switch (command) {
    case "init":
      return runInit(rootDir, rest[0]);
    case "sync":
      return runSync(rootDir);
    case "env:check":
      return runEnvCheck(rootDir);
    case "update":
      return runUpdate(rootDir);
    case "new":
      if (rest[0] !== "module" || !rest[1]) {
        console.error('Usage: tulipes new module <name>');
        process.exitCode = 2;
        return;
      }
      return runNewModule(rootDir, rest[1]);
    case "dev":
      return runDev(rootDir, rest[0] ?? "app.ts");
    case "-v":
    case "--version":
    case "version":
      console.log(coreVersion());
      return;
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
