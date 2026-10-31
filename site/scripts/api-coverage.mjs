// Lists every exported symbol without TSDoc, per package (plan D02; D07 makes it fail with --strict).
// starlight-typedoc never runs TypeDoc's validation, so this runs it separately with `--emit none`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { apiPackages } from "../api-packages.mjs";

const typedoc = fileURLToPath(new URL("../node_modules/.bin/typedoc", import.meta.url));
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--list");
let total = 0;

for (const { name, tsconfig, entryPoints } of apiPackages) {
  const run = spawnSync(typedoc, ["--tsconfig", tsconfig, "--emit", "none", "--validation.notDocumented", "--excludeExternals", ...entryPoints], { encoding: "utf8" });
  let output = `${run.stdout}${run.stderr}`;
  if (run.status !== 0) throw new Error(`typedoc failed for ${name}:\n${output}`);
  output = output.replace(/\x1b\[[0-9;]*m/g, "");
  const missing = [...output.matchAll(/\[warning\] (.+?), defined in .+? does not have any documentation/g)].map(m => m[1]);
  total += missing.length;
  console.log(`${name}: ${missing.length} undocumented`);
  if (verbose) for (const symbol of missing) console.log(`  - ${symbol}`);
}

console.log(`Total: ${total} exported symbol(s) without TSDoc.`);
if (strict && total > 0) process.exit(1);
