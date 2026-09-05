import { runInit } from "./init.js";
import { runSync } from "./sync.js";
import { runEnvCheck } from "./env-check.js";
import { runNewModule } from "./new-module.js";
import { runDev } from "./dev.js";
import { runUpdate } from "./update.js";
import { runRoutes } from "./routes.js";
import { appCoreVersion, coreVersion } from "./package-info.js";

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
  tulipes routes               list every declared endpoint, with the roles that reach it
  tulipes new module <name>    scaffold a module under ./modules
  tulipes update               upgrade the global cli and, inside an app, the app itself
  tulipes -v                   print the cli version (and the app's, when they differ)
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
    case "routes":
      return runRoutes(rootDir);
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
    case "version": {
      const cli = coreVersion();
      const app = appCoreVersion(rootDir);
      // The CLI on your PATH and the copy an app installs are separate
      // installs. Printing one number would hide a mismatch that explains
      // otherwise baffling behaviour, so say both whenever they differ.
      console.log(app && app !== cli ? `cli ${cli}\napp ${app}` : cli);
      return;
    }
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
