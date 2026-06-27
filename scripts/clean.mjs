/**
 * Removes the `build/` output directory before a fresh compile.
 *
 * `tsc` never deletes outputs whose source was renamed or removed, leaving
 * orphaned `.js` behind. That matters here because the app auto-imports every
 * compiled `*.model.js` under each module's models folder on boot — a stale file
 * would register a phantom Mongoose model. Cleaning first keeps `build/` in sync
 * with `src/`.
 */
import { rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bold, cyan, dim, green } from "colorette"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

rmSync(resolve(root, "build"), { recursive: true, force: true })

console.log(`${green(bold("✓"))} cleaned ${cyan("build/")} ${dim("(removed stale output)")}`)
