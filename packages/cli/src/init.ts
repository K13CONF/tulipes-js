import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { packageRoot } from "./package-info.js";
import { minimalTemplate, productionTemplate, renderTemplate } from "./template.js";

/**
 * `tulipes init [dir]` — scaffold a complete application from a template
 * tree. The production preset is the reference application the framework
 * is developed against, copied verbatim and transformed only in the ways
 * `template.ts` lists; the minimal preset is a three-module API with no
 * infrastructure. Neither is rendered from strings, so what this command
 * writes and what the repository tests are the same files.
 */
export type InitPreset = "minimal" | "production";

/**
 * What the production preset composes. Models are not optional there: auth,
 * users and settings own models, so the preset without a database is a
 * different application, not a feature toggle. Queues and sockets are.
 */
export interface InitFeatures {
  queues: boolean;
  sockets: boolean;
}

export const FULL_FEATURES: InitFeatures = { queues: true, sockets: true };

export async function runInit(
  rootDir: string,
  target?: string,
  preset: InitPreset = "minimal",
  features: InitFeatures = FULL_FEATURES,
): Promise<void> {
  const dir = resolve(rootDir, target ?? ".");
  const name = sanitizeName(basename(dir));

  if (existsSync(dir) && readdirSync(dir).some((entry) => entry !== ".git")) {
    console.error(`refusing to init: ${dir} is not empty`);
    process.exitCode = 1;
    return;
  }

  const source = preset === "minimal" ? minimalTemplate() : productionTemplate();
  const files = renderTemplate(source, { name, preset, features });

  for (const [relPath, content] of files) {
    const filePath = join(dir, relPath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    console.log(`  create ${relPath}`);
  }

  copyAgentGuides(dir);

  console.log([
    "",
    `Project "${name}" is ready. Next:`,
    "",
    target && target !== "." ? `  cd ${target}` : undefined,
    "  npm install -g pnpm   # once per machine",
    "  pnpm install",
    "  pnpm dev",
    "",
    "  → http://localhost:3000/api/v1/hello",
    "",
    preset === "production" ? "Needs mongo and redis running — see MONGO_URI / REDIS_URL in" : "No MongoDB or Redis required. Health: http://localhost:3000/health",
    preset === "production" ? `.envs/.env.development.${features.queues ? " Run `pnpm worker` in a second terminal to" : ""}` : undefined,
    preset === "production" && features.queues ? "consume queued jobs." : undefined,
    preset === "production" && !features.queues ? "Generated without queues: no worker process, no @tulipes/bullmq." : undefined,
    preset === "production" && !features.sockets ? "Generated without sockets: no Socket.IO namespaces, no @tulipes/socket.io." : undefined,
  ].filter((line) => line !== undefined).join("\n"));
}

/**
 * The agent guides are shared by both presets and live once, under
 * templates/: AGENTS.md, the CLAUDE.md bridge and the task-scoped skills.
 */
function copyAgentGuides(dir: string): void {
  const templates = join(packageRoot(), "templates");
  if (!existsSync(templates)) return; // tolerate a stripped install

  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    const source = join(templates, file);
    if (!existsSync(source)) continue;
    cpSync(source, join(dir, file));
    console.log(`  create ${file}`);
  }

  const skills = join(templates, "claude");
  if (existsSync(skills)) {
    cpSync(skills, join(dir, ".claude"), { recursive: true });
    for (const skill of readdirSync(join(skills, "skills"))) {
      console.log(`  create .claude/skills/${skill}/SKILL.md`);
    }
  }
}

function sanitizeName(raw: string): string {
  const name = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return name || "tulipes-app";
}
