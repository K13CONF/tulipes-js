/**
 * Generates an RSA key pair for signing/verifying RS256 JWTs.
 *
 * RS256 is asymmetric: the private key signs tokens, the public key verifies
 * them. The env schema (`src/config/env.ts`) expects both as the
 * `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` string values, so this prints them in a
 * `.env`-ready single-line form (PEM newlines escaped as `\n`, wrapped in double
 * quotes — dotenv expands those back into a real multi-line PEM at load time).
 *
 * Usage:
 *   node scripts/generate-jwt-keys.mjs                 # print to stdout
 *   node scripts/generate-jwt-keys.mjs --env development  # also write .envs/.env.development
 *   node scripts/generate-jwt-keys.mjs --bits 4096     # stronger key (default 2048)
 *   yarn keys:jwt --env production
 */
import { generateKeyPairSync } from "node:crypto"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bold, cyan, dim, green, red, yellow } from "colorette"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getFlag = (name) => {
    const i = args.indexOf(name)
    return i !== -1 ? (args[i + 1] ?? "") : undefined
}

if (args.includes("-h") || args.includes("--help")) {
    console.log(`${bold("Generate an RS256 JWT key pair")}

  node scripts/generate-jwt-keys.mjs [--env <name>] [--bits <n>]

  --env <name>   also write the keys into .envs/.env.<name> (e.g. development, production)
  --bits <n>     RSA modulus length in bits (default 2048; use 4096 for extra strength)
  -h, --help     show this help`)
    process.exit(0)
}

const envName = getFlag("--env")
const bits = Number(getFlag("--bits") ?? 2048)

if (!Number.isInteger(bits) || bits < 2048) {
    console.error(`${red("✗")} --bits must be an integer ≥ 2048 (got ${yellow(String(bits))})`)
    process.exit(1)
}

// ── Generate ─────────────────────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

/** Collapse a PEM block into a single double-quoted `.env` value (`\n` escaped). */
const toEnvValue = (pem) => `"${pem.replace(/\n/g, "\\n")}"`

console.log(`${green(bold("✓"))} generated RSA-${bits} key pair ${dim("(RS256)")}\n`)
console.log(dim("─".repeat(72)))
console.log(privateKey.trimEnd())
console.log(dim("─".repeat(72)))
console.log(publicKey.trimEnd())
console.log(dim("─".repeat(72)))

// ── Write into an env file, or print copy-paste lines ────────────────────────
if (envName) {
    const envPath = resolve(root, ".envs", `.env.${envName}`)
    if (!existsSync(envPath)) {
        console.error(`\n${red("✗")} env file not found: ${cyan(envPath)}`)
        process.exit(1)
    }

    let content = readFileSync(envPath, "utf8")
    const upsert = (key, value) => {
        const line = `${key}=${value}`
        const re = new RegExp(`^${key}=.*$`, "m")
        content = re.test(content)
            ? content.replace(re, line)
            : content.replace(/\n*$/, `\n${line}\n`)
    }

    upsert("JWT_ALGORITHM", "RS256")
    upsert("JWT_PRIVATE_KEY", toEnvValue(privateKey))
    upsert("JWT_PUBLIC_KEY", toEnvValue(publicKey))
    writeFileSync(envPath, content)

    console.log(`\n${green(bold("✓"))} wrote JWT_ALGORITHM, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY → ${cyan(`.envs/.env.${envName}`)}`)
} else {
    console.log(`\n${dim("Add these to your .env file (or re-run with")} ${cyan("--env <name>")}${dim("):")}\n`)
    console.log(`JWT_ALGORITHM=RS256`)
    console.log(`JWT_PRIVATE_KEY=${toEnvValue(privateKey)}`)
    console.log(`JWT_PUBLIC_KEY=${toEnvValue(publicKey)}`)
}
