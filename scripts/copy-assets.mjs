/**
 * Copies non-TypeScript assets (i18n JSON, views, etc.) from `src/` into
 * `build/`, preserving the folder structure.
 *
 * `tsc` only emits the compiled `.js`; everything else a module ships beside its
 * code (locale files, templates) would otherwise be missing at runtime — which
 * is exactly what makes the i18n loader log "i18nFolderPath … was not found".
 * Run as the last step of `yarn build`.
 */
import { cpSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bold, cyan, dim, green } from "colorette"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const src = resolve(root, "src")
const dest = resolve(root, "build")

cpSync(src, dest, {
    recursive: true,
    // Everything except the TypeScript sources tsc already compiled.
    filter: (source) => !source.endsWith(".ts"),
})

console.log(`${green(bold("✓"))} copied non-TS assets  ${cyan("src/")} ${dim("→")} ${cyan("build/")}`)
