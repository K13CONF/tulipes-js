import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `tulipes migrate 0.12`, the scaffold step — the reference app's own idioms
 * that the generic environment rules cannot read, rewritten by text.
 *
 * A generated app owns these files, so they are migrated the way the app's
 * code is: each rewrite matches the scaffold's exact text and is a no-op
 * when the file was edited past recognition, in which case the generic
 * step has already left a TODO naming what to do. The same approach moved
 * `inspectRoutes()` in 0.11.
 */

interface Rewrite {
  file: string;
  /** What the 0.11 scaffold wrote, verbatim. */
  from: string;
  to: string;
  note: string;
}

const REWRITES: Rewrite[] = [
  {
    file: "modules/auth/bootstrap/credentials.bootstrap.ts",
    // The names are the ones the environment step derives from the variables
    // (`AUTH_ADMIN_EMAIL` → `authAdminEmail`), not the fresh scaffold's.
    note: "reads config.auth.*, names the variables in its message",
    from: `export default function credentials({ Environment }: RuntimeCtx): void {
  if (Environment.appEnv !== "production" && Environment.appEnv !== "staging") return;
  const invalid: string[] = [];
  const defaults = [
    ["JWT_ACCESS_SECRET", "dev-only-access-secret-change-me"],
    ["JWT_REFRESH_SECRET", "dev-only-refresh-secret-change-me"],
    ["AUTH_ADMIN_PASSWORD", "dev-admin-password"],
    ["AUTH_ADMIN_EMAIL", "admin@example.com"],
  ] as const;
  for (const [name, developmentValue] of defaults) {
    const value = String(Environment.get(name)).trim();
    if (!value || value === developmentValue) invalid.push(name);
  }
  if (Environment.get("JWT_ACCESS_SECRET") === Environment.get("JWT_REFRESH_SECRET")) {
    invalid.push("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (use distinct keys)");
  }
  if (invalid.length) throw new Error("Unsafe production credentials: configure " + invalid.join(", "));
}`,
    to: `const PLACEHOLDERS = [
  ["jwtAccessSecret", "JWT_ACCESS_SECRET", "dev-only-access-secret-change-me"],
  ["jwtRefreshSecret", "JWT_REFRESH_SECRET", "dev-only-refresh-secret-change-me"],
  ["authAdminPassword", "AUTH_ADMIN_PASSWORD", "dev-admin-password"],
  ["authAdminEmail", "AUTH_ADMIN_EMAIL", "admin@example.com"],
] as const;

export default function credentials({ appEnv, config }: RuntimeCtx): void {
  if (appEnv !== "production" && appEnv !== "staging") return;

  // The values are this module's environment values; the message names the
  // variables an operator sets, not the config names.
  const auth = config.auth!;
  const invalid: string[] = [];

  for (const [name, variable, developmentValue] of PLACEHOLDERS) {
    const value = auth[name].trim();
    if (!value || value === developmentValue) invalid.push(variable);
  }
  if (auth.jwtAccessSecret === auth.jwtRefreshSecret) {
    invalid.push("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (use distinct keys)");
  }

  if (invalid.length) throw new Error("Unsafe production credentials: configure " + invalid.join(", "));
}`,
  },
  {
    file: "modules/auth/helpers/tokens.ts",
    note: "the signing keys are config.auth.*",
    from: `const secret = (ctx: Ctx, typ: "access" | "refresh"): string =>
  String(
    ctx.Environment.get(
      typ === "access" ? "JWT_ACCESS_SECRET" : "JWT_REFRESH_SECRET",
    ),
  );`,
    to: `const secret = (ctx: Ctx, typ: "access" | "refresh"): string =>
  typ === "access" ? ctx.config.auth!.jwtAccessSecret : ctx.config.auth!.jwtRefreshSecret;`,
  },
  {
    file: "modules/config/helpers/describe.ts",
    note: "the console describes environment values through ctx.settings.describeEnv()",
    from: `  const variables = ctx.Environment.store.describe()
    .filter((variable) => variable.owner === name)
    .map((variable) => ({
      name: variable.spec.name,
      type: variable.spec.type,
      description: variable.spec.description,
      group: variable.spec.group ?? null,
      required: variable.spec.required ?? false,
      enum: variable.spec.enum ?? null,
      default: variable.spec.type === "secret" ? null : (variable.spec.default ?? null),
      source: variable.source,
      is_secret: variable.isSecret,
      is_set: variable.isSet,
      // What this process resolved; a secret is never here.
      value: variable.isSecret ? null : (variable.value ?? null),
    }));`,
    to: `  // The env half of the module's namespace, as the framework describes it:
  // a secret's value and default are already withheld.
  const variables = ctx.settings.describeEnv(name).map((variable) => ({
    name: variable.name,
    key: variable.key,
    type: variable.type,
    description: variable.description,
    group: variable.group ?? null,
    required: variable.required,
    enum: variable.enum ?? null,
    default: variable.default ?? null,
    source: variable.source ?? null,
    is_secret: variable.isSecret,
    is_set: variable.isSet,
    value: variable.value ?? null,
  }));`,
  },
  {
    file: "modules/settings/tests/settings.test.ts",
    note: "the stream tests boot with file logging on, into a directory they own",
    from: `const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });
`,
    to: `/**
 * Where this boot's logger writes and the stream reads: environment values
 * are bound once at boot, so the file logging the stream needs is on for
 * the whole file, into a directory the suite owns and empties per test.
 */
const logDir = mkdtempSync(join(tmpdir(), "tulipes-log-http-"));
const app = useTestApp({ rootDir, env: { ...testEnv(), LOG_FILE: "true", LOG_DIR: logDir }, settings: testSettings() }, { beforeAll, afterAll });
afterAll(() => rm(logDir, { recursive: true, force: true }));
`,
  },
  {
    file: "modules/settings/tests/settings.test.ts",
    note: "logFiles() empties the directory instead of changing read-only values",
    from: `async function logFiles(run: (dir: string) => Promise<void>) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "tulipes-log-http-"));
  const env = app.handle.ctx.Environment;

  const previous = {
    file: env.get("LOG_FILE"),
    dir: env.get("LOG_DIR"),
  };

  env.store.set("LOG_FILE", true);

  env.store.set("LOG_DIR", dir);

  try {
    await run(dir);
  } finally {
    env.store.set("LOG_FILE", previous.file);

    env.store.set("LOG_DIR", previous.dir);

    await rm(dir, { recursive: true, force: true });
  }
}`,
    to: `/** \`run\` sees the log directory empty: one test's files never serve another's stream. */
async function logFiles(run: (dir: string) => Promise<void>) {
  const empty = async () => {
    for (const entry of await readdir(logDir)) await rm(join(logDir, entry), { recursive: true, force: true });
  };
  await empty();
  try {
    await run(logDir);
  } finally {
    await empty();
  }
}`,
  },
  {
    file: "modules/settings/tests/settings.test.ts",
    note: "a second boot reads the same LOG_FILE and LOG_DIR from the process",
    from: `      try {
        next.env.store.set("LOG_FILE", true);

        next.env.store.set("LOG_DIR", dir);

        const address = next.server!.address();`,
    to: `      try {
        // LOG_FILE and LOG_DIR are still set on the process, so this boot
        // reads the same directory.
        const address = next.server!.address();`,
  },
  {
    file: "modules/settings/tests/settings.test.ts",
    note: "the imports the rewritten helpers use",
    from: `import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";`,
    to: `import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";`,
  },
];

export function migrateScaffoldIdioms(rootDir: string, changed: string[]): void {
  for (const rewrite of REWRITES) {
    const file = join(rootDir, rewrite.file);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes(rewrite.from)) continue; // edited, or already migrated
    writeFileSync(file, source.replace(rewrite.from, rewrite.to));
    changed.push(`${relative(rootDir, file)}: ${rewrite.note}`);
  }
}
