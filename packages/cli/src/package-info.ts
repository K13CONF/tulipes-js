import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This CLI's own package root (templates live there). Resolved relative to
 * this file — src/ and dist/ both sit one level below it.
 */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Version of this CLI. */
export function cliVersion(): string {
  return versionAt(packageRoot()) ?? "unknown";
}

/**
 * Version of the @tulipes/core this CLI bundles and scaffolds for. The
 * exports map hides core's package.json, so walk up from its entrypoint.
 */
export function coreVersion(): string {
  try {
    const entry = createRequire(join(packageRoot(), "package.json")).resolve("@tulipes/core");
    let dir = dirname(entry);
    for (let depth = 0; depth < 5; depth++) {
      const version = versionAt(dir);
      if (version && readFileSync(join(dir, "package.json"), "utf8").includes('"name": "@tulipes/core"')) return version;
      dir = dirname(dir);
    }
  } catch {
    // fall through
  }
  return "unknown";
}

/**
 * Version of the core installed in an app, which is a different install
 * from the global CLI and can therefore be a different version. Undefined
 * when the directory is not an app, or its dependencies aren't installed.
 */
export function appCoreVersion(rootDir: string): string | undefined {
  return versionAt(join(rootDir, "node_modules", "@tulipes", "core"));
}

function versionAt(packageDir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}
