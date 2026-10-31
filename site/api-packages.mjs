// The packages the API reference covers, one entry point per `exports` subpath.
// The CLI is left out: apps never import it, and it gets its own command reference.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIRS = ["core", "mongoose", "bullmq", "socket.io", "mcp", "spec", "testing"];

export const apiPackages = DIRS.map(dir => {
  const root = fileURLToPath(new URL(`../packages/${dir}/`, import.meta.url));
  const { name, exports } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  // entry file → the import specifier a reader writes ("@tulipes/core/acl")
  const importPaths = Object.fromEntries(
    Object.entries(exports).map(([subpath, file]) => [
      root + file.replace(/^\.\//, ""),
      subpath === "." ? name : name + subpath.slice(1),
    ]),
  );
  return { dir, name, tsconfig: `${root}tsconfig.json`, entryPoints: Object.keys(importPaths), importPaths };
});
