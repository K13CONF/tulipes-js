/**
 * Interactive project initializer.
 *
 * When this boilerplate is cloned as a template, run this script to replace all
 * project-specific placeholders (name, title, DB name, PM2 process names, brand
 * name in emails, etc.) in one shot.
 *
 * Usage:
 *   node scripts/init.mjs
 *   yarn init
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { execSync } from "node:child_process"
import { bold, cyan, dim, green, red, yellow } from "colorette"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Lowercase slug: `My App_name!` → `my-app-name` */
function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/^-+|-+$/g, "")
}

/** `my-awesome-api` → `My Awesome Api` */
function slugToTitle(slug) {
    return slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
}

/** Best-effort git user.name, or empty string. */
function getGitUser() {
    try {
        return execSync("git config user.name", { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim()
    } catch {
        return ""
    }
}

/** Promisified readline question — returns `defaultVal` on empty input. */
function ask(rl, label, defaultVal) {
    const hint = defaultVal ? dim(` [${defaultVal}]`) : dim(" [leave blank]")
    return new Promise((resolve) => {
        rl.question(`  ${bold(label)}${hint}: `, (answer) => {
            resolve(answer.trim() || defaultVal || "")
        })
    })
}

/** Upsert a key in a dotenv file string (same pattern as generate-jwt-keys.mjs). */
function upsertEnv(content, key, value) {
    const line = `${key}=${value}`
    const re = new RegExp(`^${key}=.*$`, "m")
    return re.test(content)
        ? content.replace(re, line)
        : content.replace(/\n*$/, `\n${line}\n`)
}

/** Extract a regex match group from a file string, or fallback. */
function extract(content, regex, fallback = "") {
    const m = content.match(regex)
    return m ? m[1] : fallback
}

// ── Paths ───────────────────────────────────────────────────────────────────

const paths = {
    pkg: resolve(root, "package.json"),
    appConfig: resolve(root, "src/config/app.config.ts"),
    ecosystem: resolve(root, "ecosystem.config.cjs"),
    envDev: resolve(root, ".envs/.env.development"),
    envExample: resolve(root, ".envs/.env.example"),
    emailTheme: resolve(root, "src/emails/theme.ts"),
    readme: resolve(root, "README.md"),
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n${bold("  Project initializer")}\n`)

    // 1. Read current values for defaults
    const pkg = JSON.parse(readFileSync(paths.pkg, "utf8"))
    const appConfigSrc = readFileSync(paths.appConfig, "utf8")

    const currentSlug = pkg.name || basename(root)
    const currentTitle = extract(appConfigSrc, /\btitle:\s*"([^"]*)"/) || slugToTitle(currentSlug)
    const currentDesc = pkg.description || ""
    const currentAuthor = pkg.author || getGitUser()

    // 2. Prompt
    const rl = createInterface({ input: process.stdin, output: process.stdout })

    let slug = ""
    while (!slug) {
        const raw = await ask(rl, "Project name (slug)", currentSlug)
        slug = slugify(raw)
        if (!slug) console.log(`  ${red("✗")} invalid slug, try again`)
    }

    const title = await ask(rl, "Project title       ", currentSlug === slug ? currentTitle : slugToTitle(slug))
    const description = await ask(rl, "Description         ", currentDesc)
    const author = await ask(rl, "Author              ", currentAuthor)

    rl.close()

    // 3. Summary
    console.log(`\n${dim("  ─".repeat(24))}`)
    console.log(`  ${bold("Summary of changes:")}\n`)

    const changes = [
        ["package.json", "name", currentSlug, slug],
        ["package.json", "description", currentDesc, description],
        ["package.json", "author", currentAuthor, author],
        ["app.config.ts", "title", currentTitle, title],
        ["app.config.ts", "description", currentDesc, description],
        ["ecosystem.config.cjs", "web process", `${currentSlug}-web`, `${slug}-web`],
        ["ecosystem.config.cjs", "worker process", `${currentSlug}-worker`, `${slug}-worker`],
        [".env.development", "DATABASE_NAME", currentSlug, slug],
        [".env.example", "DATABASE_NAME", currentSlug, slug],
        ["emails/theme.ts", "brand name", currentTitle, title],
        ["README.md", "project name", currentSlug, slug],
    ]

    for (const [file, field, oldVal, newVal] of changes) {
        const changed = oldVal !== newVal
        const arrow = changed ? dim(" → ") : dim(" = ")
        const val = changed ? cyan(newVal) : dim(newVal)
        console.log(`  ${dim(file.padEnd(24))} ${field.padEnd(16)} ${arrow} ${val}`)
    }

    // 4. Confirm
    console.log()
    const rl2 = createInterface({ input: process.stdin, output: process.stdout })
    const confirm = await new Promise((resolve) => {
        rl2.question(`  ${bold("Apply changes?")} ${dim("[Y/n]")}: `, (a) => resolve(a.trim()))
    })
    rl2.close()

    if (confirm && confirm.toLowerCase() !== "y") {
        console.log(`\n  ${yellow("✗")} aborted\n`)
        process.exit(0)
    }

    // 5. Apply mutations
    const updated = []

    // 5a. package.json — JSON parse/stringify
    pkg.name = slug
    pkg.description = description
    pkg.author = author
    writeFileSync(paths.pkg, JSON.stringify(pkg, null, 2) + "\n")
    updated.push("package.json")

    // 5b. src/config/app.config.ts — regex
    let appConfig = readFileSync(paths.appConfig, "utf8")
    appConfig = appConfig.replace(/(\btitle:\s*)"[^"]*"/, `$1"${title}"`)
    appConfig = appConfig.replace(/(\bdescription:\s*)"[^"]*"/, `$1"${description}"`)
    writeFileSync(paths.appConfig, appConfig)
    updated.push("src/config/app.config.ts")

    // 5c. ecosystem.config.cjs — global replaceAll using current slug
    let eco = readFileSync(paths.ecosystem, "utf8")
    eco = eco.replaceAll(`${currentSlug}-web`, `${slug}-web`)
    eco = eco.replaceAll(`${currentSlug}-worker`, `${slug}-worker`)
    writeFileSync(paths.ecosystem, eco)
    updated.push("ecosystem.config.cjs")

    // 5d. .envs/.env.development
    if (existsSync(paths.envDev)) {
        let envDev = readFileSync(paths.envDev, "utf8")
        envDev = upsertEnv(envDev, "DATABASE_NAME", slug)
        writeFileSync(paths.envDev, envDev)
        updated.push(".envs/.env.development")
    } else {
        console.log(`  ${yellow("⚠")} skipped .envs/.env.development (not found)`)
    }

    // 5e. .envs/.env.example
    let envExample = readFileSync(paths.envExample, "utf8")
    envExample = upsertEnv(envExample, "DATABASE_NAME", slug)
    writeFileSync(paths.envExample, envExample)
    updated.push(".envs/.env.example")

    // 5f. src/emails/theme.ts — brand name
    let theme = readFileSync(paths.emailTheme, "utf8")
    theme = theme.replace(/(\bname:\s*)"[^"]*"/, `$1"${title}"`)
    writeFileSync(paths.emailTheme, theme)
    updated.push("src/emails/theme.ts")

    // 5g. README.md — ordered replaceAll (suffixed forms first, then bare slug)
    let readme = readFileSync(paths.readme, "utf8")
    readme = readme.replaceAll(`${currentSlug}-web`, `${slug}-web`)
    readme = readme.replaceAll(`${currentSlug}-worker`, `${slug}-worker`)
    readme = readme.replaceAll(currentSlug, slug)
    writeFileSync(paths.readme, readme)
    updated.push("README.md")

    // 6. Done
    console.log(`\n  ${green(bold("✓"))} updated ${updated.length} files\n`)
    for (const f of updated) {
        console.log(`    ${cyan(f)}`)
    }
    console.log()
}

main()
