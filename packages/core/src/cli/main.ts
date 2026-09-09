import { runInit, type InitPreset } from "./init.js";
import { runSync } from "./sync.js";
import { runEnvCheck } from "./env-check.js";
import { runNewModule } from "./new-module.js";
import { runDev } from "./dev.js";
import { runUpdate } from "./update.js";
import { runRoutes } from "./routes.js";
import { runSpec } from "./spec.js";
import { appCoreVersion, coreVersion } from "./package-info.js";

/**
 * The `tulipes` CLI. Deliberately dependency-free argument handling — a
 * handful of commands don't justify a parser library.
 * All commands operate on the app in the current working directory.
 */
const HELP = `tulipes — module-based express framework

Usage:
  tulipes init [dir]           scaffold a minimal API (no mongo/redis)
                                 --minimal | --preset minimal | --preset production
  tulipes dev [entry]          run with tsx in watch mode (default entry: app.ts), sync first
  tulipes sync                 regenerate types/config.d.ts and .env.example
  tulipes env:check            validate env against every meta.variables.json (CI-friendly)
  tulipes routes               list every declared endpoint, with the roles that reach it
  tulipes spec [options]       write an OpenAPI document / Postman collection (needs @tulipes/spec)
                                 --openapi <file>  --postman <file>  --url <base>
  tulipes new module <name>    scaffold a module under ./modules
  tulipes update               upgrade the global cli and, inside an app, the app itself
  routes/spec inspect configured infrastructure; minimal apps need no services.
  tulipes -v                   print the cli version (and the app's, when they differ)
`;

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const rootDir = process.cwd();

  switch (command) {
    case "init": {
      try {
        const { target, preset } = initArguments(rest);
        return await runInit(rootDir, target, preset);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "sync":
      return runSync(rootDir);
    case "env:check":
      return runEnvCheck(rootDir);
    case "routes":
      return runRoutes(rootDir);
    case "spec":
      return runSpec(rootDir, {
        ...(flag(rest, "--openapi") && { openapi: flag(rest, "--openapi")! }),
        ...(flag(rest, "--postman") && { postman: flag(rest, "--postman")! }),
        ...(flag(rest, "--url") && { url: flag(rest, "--url")! }),
      });
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

/** `--name value` → value. Absent, or missing its value, reads as unset. */
function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/** Validate the complete init invocation before creating any files. */
function initArguments(args: readonly string[]): { target?: string; preset: InitPreset } {
  let target: string | undefined;
  let preset: InitPreset | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--minimal" || arg === "--preset") {
      const value = arg === "--minimal" ? "minimal" : args[++index];
      if (value !== "minimal" && value !== "production") throw new Error("--preset requires minimal or production");
      if (preset && preset !== value) throw new Error("Conflicting init presets");
      preset = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown init option: ${arg}`);
    } else if (target !== undefined) {
      throw new Error("init accepts only one target directory");
    } else target = arg;
  }
  return { target, preset: preset ?? "minimal" };
}
