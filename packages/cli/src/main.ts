import { RAI_SEGMENT } from "@tulipes/core/acl";

import { FULL_FEATURES, runInit, type InitFeatures, type InitPreset } from "./init.ts";
import { runSync } from "./sync.ts";
import { runEnvCheck } from "./env-check.ts";
import { runNewModule } from "./new-module.ts";
import { runDev } from "./dev.ts";
import { runUpdate } from "./update.ts";
import { runConfigCheck } from "./config-check.ts";
import { runRoles } from "./roles.ts";
import { runRoutes } from "./routes.ts";
import { runSpec } from "./spec.ts";
import { runAgentManifest } from "./agent.ts";
import { runMigrate } from "./migrate.ts";
import { runConfigImport } from "./config-import.ts";
import { appCoreVersion, cliVersion, coreVersion } from "./package-info.ts";

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
  tulipes dev [entry]          run the entrypoint with node --watch (default: app.ts), sync first
  tulipes sync                 regenerate types/tulipes.d.ts and .env.example
  tulipes env:check            validate env against every module's tulipes.env (CI-friendly)
  tulipes config:check         load every settings namespace from the store and print it
  tulipes routes               list every declared endpoint, with the roles that reach it
                                 --scope <scope>  only the endpoints of one scope (bo, web, …)
  tulipes roles                list every role: description, extras, who defined it, its grants
                                 --role <role>  only that role
  tulipes spec [options]       write an OpenAPI document / Postman collection (needs @tulipes/spec)
                                 --openapi <file>  --postman <file>  --url <base>
                                 --scope <scope>  describe one client surface only
                                 all three inspect the app: no service, secret or .env is needed
  tulipes migrate 0.11         rewrite an app generated on 0.10 to the 0.11 layout and contracts
  tulipes config:import        carry .envs values that became settings into the store
                                 --env <APP_ENV>  --from <file>  --dry-run
  tulipes agent manifest       print every tool the app exposes to agents, as JSON
                                 --out <file>  write it instead   --role <role>  only what that role may call
  tulipes new module <name>    scaffold a module under ./modules
                                 --scope <scope>         the surface its first endpoint serves (default: web)
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
    case "config:import": {
      try {
        return await runConfigImport(rootDir, importArguments(rest));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "migrate":
      if (rest.length !== 1) {
        console.error("Usage: tulipes migrate 0.11");
        process.exitCode = 2;
        return;
      }
      return runMigrate(rootDir, rest[0]!);
    case "env:check":
      return runEnvCheck(rootDir);
    case "routes":
    case "spec": {
      try {
        const options = inspectionArguments(rest, command);
        return command === "routes" ? await runRoutes(rootDir, options) : await runSpec(rootDir, options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "roles": {
      try {
        return await runRoles(rootDir, rolesArguments(rest));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "agent": {
      if (rest[0] !== "manifest") {
        console.error("Usage: tulipes agent manifest [--out <file>] [--role <role>]");
        process.exitCode = 2;
        return;
      }
      try {
        return await runAgentManifest(rootDir, agentArguments(rest.slice(1)));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
      }
    }
    case "update":
      return runUpdate(rootDir);
    case "new": {
      const parsed = rest[0] === "module" && rest[1] ? newModuleArguments(rest.slice(2)) : undefined;
      if (!parsed) {
        console.error('Usage: tulipes new module <name> [--scope <scope>] [--model | --no-model] [--queues | --no-queues] [--sockets | --no-sockets]');
        process.exitCode = 2;
        return;
      }
      return runNewModule(rootDir, rest[1]!, parsed);
    }
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
  const options: { openapi?: string; postman?: string; url?: string; scope?: string } = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--offline" || arg === "--runtime") {
      throw new Error(`${arg} was removed in 0.11: ${command} always inspects the app without services, secrets or a .env`);
    } else if (arg === "--scope" || (command === "spec" && (arg === "--openapi" || arg === "--postman" || arg === "--url"))) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2) as "openapi" | "postman" | "url" | "scope";
      if (options[key]) throw new Error(`Duplicate option: ${arg}`);
      if (key === "scope" && !RAI_SEGMENT.test(value)) {
        throw new Error(`--scope "${value}" is not a scope — lowercase, starting with a letter ([a-z][a-z0-9-]*)`);
      }
      options[key] = value;
    } else throw new Error(`Unknown ${command} option: ${arg}`);
  }
  return options;
}

const NEW_MODULE_FLAGS: Record<string, { models?: boolean; queues?: boolean; sockets?: boolean }> = {
  "--model": { models: true },
  "--no-model": { models: false },
  "--queues": { queues: true },
  "--no-queues": { queues: false },
  "--sockets": { sockets: true },
  "--no-sockets": { sockets: false },
};

/** Undefined for anything the usage line does not allow. */
function newModuleArguments(args: readonly string[]) {
  let options: { models?: boolean; queues?: boolean; sockets?: boolean; scope?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--scope") {
      const value = args[++i];
      if (!value || value.startsWith("-") || options.scope !== undefined) return undefined;
      options.scope = value;
    } else if (NEW_MODULE_FLAGS[flag]) {
      options = { ...options, ...NEW_MODULE_FLAGS[flag] };
    } else return undefined;
  }
  return options;
}

function rolesArguments(args: readonly string[]): { role?: string } {
  const options: { role?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--role" && value && !value.startsWith("-") && options.role === undefined) {
      options.role = value;
      i++;
      continue;
    }
    throw new Error(`unknown or incomplete option "${flag}" — usage: tulipes roles [--role <role>]`);
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

function agentArguments(args: readonly string[]): { out?: string; role?: string } {
  const options: { out?: string; role?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if ((flag === "--out" || flag === "--role") && value && !value.startsWith("--")) {
      options[flag === "--out" ? "out" : "role"] = value;
      i++;
      continue;
    }
    throw new Error(`unknown or incomplete option "${flag}" — usage: tulipes agent manifest [--out <file>] [--role <role>]`);
  }
  return options;
}

function importArguments(args: readonly string[]): { env?: string; from?: string; dryRun?: boolean } {
  const options: { env?: string; from?: string; dryRun?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    if ((flag === "--env" || flag === "--from") && value && !value.startsWith("--")) {
      options[flag === "--env" ? "env" : "from"] = value;
      i++;
      continue;
    }
    throw new Error(`unknown or incomplete option "${flag}" — usage: tulipes config:import [--env <APP_ENV>] [--from <file>] [--dry-run]`);
  }
  return options;
}
