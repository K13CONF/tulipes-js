import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The installed core's own package root. Resolved relative to this file —
 * src/cli and dist/cli both sit two levels below it — because the exports
 * map deliberately does not expose package.json.
 */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Version of the @tulipes/core running this CLI. */
export function coreVersion(): string {
  return versionAt(packageRoot()) ?? "unknown";
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
