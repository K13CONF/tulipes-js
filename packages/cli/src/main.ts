import { FULL_FEATURES, runInit, type InitFeatures, type InitPreset } from "./init.js";
import { runSync } from "./sync.js";
import { runEnvCheck } from "./env-check.js";
import { runNewModule } from "./new-module.js";
import { runDev } from "./dev.js";
import { runUpdate } from "./update.js";
import { runConfigCheck } from "./config-check.js";
import { runRoutes } from "./routes.js";
import { runSpec } from "./spec.js";
import { appCoreVersion, cliVersion, coreVersion } from "./package-info.js";

/**
 * The `tulipes` CLI. Deliberately dependency-free argument handling — a
 * handful of commands don't justify a parser library.
 * All commands operate on the app in the current working directory.
 */
const HELP = `tulipes — module-based express framework

Usage:
  tulipes init [dir]           scaffold a minimal API (no mongo/redis)
                                 --minimal | --preset minimal | --preset production
                                 --no-queues | --no-sockets  (production only) leave a provider out
  tulipes dev [entry]          run with tsx in watch mode (default entry: app.ts), sync first
  tulipes sync                 regenerate types/config.d.ts and .env.example
  tulipes env:check            validate env against every module's tulipes.env (CI-friendly)
  tulipes config:check         load every settings namespace from the store and print it
  tulipes routes               list every declared endpoint, with the roles that reach it
  tulipes spec [options]       write an OpenAPI document / Postman collection (needs @tulipes/spec)
                                 --openapi <file>  --postman <file>  --url <base>
                                 both inspect the app: no service, secret or .env is needed
  tulipes new module <name>    scaffold a module under ./modules
                                 --model | --no-model    force model/bootstrap files on or off
                                 --queues | --no-queues  force the queues file on or off
                                 --sockets | --no-sockets  force the sockets file on or off
                                 (default: on when package.json declares that provider)
  tulipes update               upgrade the global cli and, inside an app, the app itself
  tulipes -v                   print the cli version (and the app's, when they differ)
`;

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const rootDir = process.cwd();

  switch (command) {
    case "init": {
      try {
        const { target, preset, features } = initArguments(rest);
        return await runInit(rootDir, target, preset, features);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "sync":
      return runSync(rootDir);
    case "config:check":
      return runConfigCheck(rootDir);
    case "env:check":
      return runEnvCheck(rootDir);
    case "routes":
    case "spec": {
      try {
        const options = inspectionArguments(rest, command);
        return command === "routes" ? await runRoutes(rootDir) : await runSpec(rootDir, options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "update":
      return runUpdate(rootDir);
    case "new":
      if (rest[0] !== "module" || !rest[1] || rest.slice(2).some((flag) => !["--model", "--no-model", "--queues", "--no-queues", "--sockets", "--no-sockets"].includes(flag))) {
        console.error('Usage: tulipes new module <name> [--model | --no-model] [--queues | --no-queues] [--sockets | --no-sockets]');
        process.exitCode = 2;
        return;
      }
      return runNewModule(rootDir, rest[1], {
        ...(rest.includes("--model") && { models: true }),
        ...(rest.includes("--no-model") && { models: false }),
        ...(rest.includes("--queues") && { queues: true }),
        ...(rest.includes("--no-queues") && { queues: false }),
        ...(rest.includes("--sockets") && { sockets: true }),
        ...(rest.includes("--no-sockets") && { sockets: false }),
      });
    case "dev":
      return runDev(rootDir, rest[0] ?? "app.ts");
    case "-v":
    case "--version":
    case "version": {
      const cli = coreVersion();
      const app = appCoreVersion(rootDir);
      // The core this CLI bundles and the copy an app installs are separate
      // installs. Printing one number would hide a mismatch that explains
      // otherwise baffling behaviour, so say both whenever they differ.
      console.log(`cli ${cliVersion()} (core ${cli})${app && app !== cli ? `\napp core ${app}` : ""}`);
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

function inspectionArguments(args: readonly string[], command: "routes" | "spec") {
  const options: { openapi?: string; postman?: string; url?: string } = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--offline" || arg === "--runtime") {
      throw new Error(`${arg} was removed in 0.11: ${command} always inspects the app without services, secrets or a .env`);
    } else if (command === "spec" && (arg === "--openapi" || arg === "--postman" || arg === "--url")) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2) as "openapi" | "postman" | "url";
      if (options[key]) throw new Error(`Duplicate option: ${arg}`);
      options[key] = value;
    } else throw new Error(`Unknown ${command} option: ${arg}`);
  }
  return options;
}

/** Validate the complete init invocation before creating any files. */
function initArguments(args: readonly string[]): { target?: string; preset: InitPreset; features: InitFeatures } {
  let target: string | undefined;
  let preset: InitPreset | undefined;
  const features: InitFeatures = { ...FULL_FEATURES };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--minimal" || arg === "--preset") {
      const value = arg === "--minimal" ? "minimal" : args[++index];
      if (value !== "minimal" && value !== "production") throw new Error("--preset requires minimal or production");
      if (preset && preset !== value) throw new Error("Conflicting init presets");
      preset = value;
    } else if (arg === "--no-queues" || arg === "--no-sockets") {
      features[arg === "--no-queues" ? "queues" : "sockets"] = false;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown init option: ${arg}`);
    } else if (target !== undefined) {
      throw new Error("init accepts only one target directory");
    } else target = arg;
  }
  // Validated before any file is written: the minimal preset has no
  // providers to leave out, so the flag would silently mean nothing.
  if ((preset ?? "minimal") === "minimal" && (!features.queues || !features.sockets)) {
    throw new Error("--no-queues and --no-sockets apply to --preset production only");
  }
  return { target, preset: preset ?? "minimal", features };
}
