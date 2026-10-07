/**
 * Install this app's nginx site config.
 *
 *   sudo -E APP_ENV=production pnpm script scripts/deploy-nginx.ts
 *   APP_ENV=production pnpm script scripts/deploy-nginx.ts --dry-run
 *
 * APP_ENV picks everything at once — which template is rendered, and the
 * domain and port rendered into it — so the three can never disagree.
 *
 * It boots in script mode like every other script, which means the database
 * and redis must be reachable from wherever you run it. That is the price
 * of every script looking the same; run --dry-run from anywhere to preview.
 *
 * Debian/Ubuntu only: it writes sites-available and links sites-enabled.
 * Certificates are yours to install — the rendered conf is HTTP-only, with
 * a commented TLS block to uncomment once they exist.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { boot } from "@tulipes/core/boot";

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const force = flags.has("--force");

const rootDir = join(import.meta.dirname, "..");
const handle = await boot({ rootDir, mode: "script" });

try {
  await deploy();
} finally {
  // Without this the open mongo and redis handles keep the process alive
  // and the script appears to hang after doing its work.
  await handle.shutdown();
}

async function deploy(): Promise<void> {
  const { appEnv } = handle.env;
  const domain = String(handle.env.get("PUBLIC_DOMAIN")).trim();
  const port = Number(handle.env.get("PORT"));

  const templatePath = join(rootDir, "nginx", `${appEnv}.conf`);
  if (!existsSync(templatePath)) {
    return fail(`no template for APP_ENV=${appEnv} — expected nginx/${appEnv}.conf`);
  }

  const conf = readFileSync(templatePath, "utf8")
    .replaceAll("{{DOMAIN}}", domain)
    .replaceAll("{{PORT}}", String(port));

  // Preview stays available everywhere, including a laptop with no nginx
  // and a domain still set to localhost.
  if (dryRun) {
    console.log(`# ${templatePath} → ${SITES_AVAILABLE}/${domain}\n`);
    console.log(conf);
    return;
  }

  if (domain === "localhost" || domain === "") {
    return fail(
      `PUBLIC_DOMAIN is "${domain}" — set a real hostname in .envs/.env.${appEnv} before deploying`,
    );
  }

  // getuid is absent on Windows; its absence is itself a "not supported here".
  if (process.getuid?.() !== 0) {
    return fail("must run as root to write /etc/nginx — re-run with sudo -E");
  }

  if (!existsSync(SITES_AVAILABLE)) {
    return fail(
      `${SITES_AVAILABLE} does not exist — this script targets the Debian/Ubuntu nginx layout`,
    );
  }

  const availablePath = join(SITES_AVAILABLE, domain);
  if (existsSync(availablePath) && !force) {
    return fail(
      `${availablePath} already exists — re-run with --force to overwrite it (it may have been hand-tuned on this box)`,
    );
  }

  writeFileSync(availablePath, conf);
  console.log(`wrote ${availablePath}`);

  const enabledPath = join(SITES_ENABLED, domain);
  if (!linkSite(availablePath, enabledPath)) return;

  if (!run("nginx", ["-t"], "nginx rejected the configuration — nothing was reloaded")) {
    return;
  }
  if (!run("systemctl", ["reload", "nginx"], "nginx reload failed")) return;

  console.log(`\n${domain} → 127.0.0.1:${port} (${appEnv}) — nginx reloaded`);
}

/** Idempotent: a link already pointing at the right file is the goal state. */
function linkSite(target: string, link: string): boolean {
  if (existsSync(link) || isSymlink(link)) {
    const current = isSymlink(link) ? readlinkSync(link) : "(a regular file)";
    if (current === target) {
      console.log(`link ${link} already correct`);
      return true;
    }
    fail(`${link} exists and points at ${current} — remove it and re-run`);
    return false;
  }

  symlinkSync(target, link);
  console.log(`linked ${link}`);
  return true;
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function run(command: string, args: string[], message: string): boolean {
  try {
    execFileSync(command, args, { stdio: "inherit" });
    return true;
  } catch (error) {
    // A missing binary is not a rejected config: reporting the latter would
    // send you hunting a syntax error that does not exist.
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    fail(missing ? `could not run "${command}" — is it installed and on PATH?` : message);
    return false;
  }
}

function fail(message: string): void {
  console.error(`deploy-nginx: ${message}`);
  process.exitCode = 1;
}
