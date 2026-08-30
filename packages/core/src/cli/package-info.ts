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
  const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}
