/**
 * Generates a Postman collection + environment from the app's own route tree.
 *
 * Imports the compiled config exactly like the app boots (env load + module/ACL
 * resolution) but never opens a DB/Redis connection or starts the HTTP server —
 * it only reads the in-memory route metadata. Run after `yarn build`.
 *
 * Usage:
 *   node scripts/generate-postman.mjs --out ./postman
 *   yarn postman:generate
 */
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bold, cyan, green, red } from "colorette"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getFlag = (name) => {
    const i = args.indexOf(name)
    return i !== -1 ? (args[i + 1] ?? "") : undefined
}

if (args.includes("-h") || args.includes("--help")) {
    console.log(`${bold("Generate a Postman collection + environment from the app's routes")}

  node scripts/generate-postman.mjs --out <dir>

  --out <dir>   directory to write the collection/environment JSON into (required)
  -h, --help    show this help

Reads the same NODE_ENV-selected .envs/.env.<name> the app boots with (default: development).`)
    process.exit(0)
}

const out = getFlag("--out")
if (!out) {
    console.error(`${red("✗")} --out <dir> is required`)
    process.exit(1)
}

// ── Generate ─────────────────────────────────────────────────────────────────
const { PostmanGenerator } = await import("#packages/postman-generator/generate.js")
const { collectionPath, environmentPath } = await new PostmanGenerator(resolve(root, out)).generate()

console.log(`${green(bold("✓"))} wrote ${cyan(collectionPath)}`)
console.log(`${green(bold("✓"))} wrote ${cyan(environmentPath)}`)
