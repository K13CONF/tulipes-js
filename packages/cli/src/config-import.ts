import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { importFromApp } from "./app-core.ts";

/**
 * `tulipes config:import` — after `tulipes migrate 0.11`, carry the values a
 * deployment kept in `.envs/.env.<APP_ENV>` for variables that became
 * settings into the settings store, so the upgraded app boots with what
 * it ran with. The mapping is `config/migration-0.11.json`, written by the
 * migration; the values are validated by each module's schema before they
 * are written, and written with the store's own versioning — through the
 * file store the app uses by default, or the Mongo store it declares.
 */
export interface ConfigImportOptions {
  /** APP_ENV to read and write for; default the process's APP_ENV or "development". */
  env?: string;
  /** An env file to read instead of `.envs/.env.<env>`. */
  from?: string;
  /** Print what would be written and write nothing. */
  dryRun?: boolean;
}

interface Mapping { settings: Record<string, Record<string, { variable: string; type: string }>> }
interface StoreLike {
  load(namespace: string): Promise<{ values: Record<string, unknown>; version: number } | undefined>;
  save(namespace: string, values: Record<string, unknown>, expectedVersion: number, actor: { id: string; label?: string }): Promise<unknown>;
  status(): { label: string };
  dispose?(): void | Promise<void>;
}

export async function runConfigImport(rootDir: string, options: ConfigImportOptions = {}): Promise<void> {
  const appEnv = options.env ?? process.env.APP_ENV ?? "development";
  const mappingFile = join(rootDir, "config", "migration-0.11.json");
  if (!existsSync(mappingFile)) {
    console.error("config/migration-0.11.json not found — run `tulipes migrate 0.11` first; it records which variables became settings");
    process.exitCode = 2;
    return;
  }
  const mapping = JSON.parse(readFileSync(mappingFile, "utf8")) as Mapping;
  const envFile = options.from ? resolve(options.from) : join(rootDir, ".envs", `.env.${appEnv}`);
  const values = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const read = (name: string): string | undefined => process.env[name] ?? values[name];
  if (!existsSync(envFile)) console.warn(`${envFile} does not exist; only process.env is read`);

  const core = await importFromApp<{ isConfigDeclaration(value: unknown): boolean; FileSettingsStore: new (rootDir: string, appEnv: string) => StoreLike }>(rootDir, "@tulipes/core/config");
  if (!core) {
    console.error("@tulipes/core is not installed in this app — pnpm install first");
    process.exitCode = 2;
    return;
  }
  const store = await openStore(rootDir, appEnv, read, core);
  if (!store) return;
  console.log(`store: ${store.status().label}`);

  let written = 0;
  try {
    for (const [namespace, fields] of Object.entries(mapping.settings)) {
      const configFile = join(rootDir, "modules", namespace, "module.config.ts");
      const exported = (await import(pathToFileURL(configFile).href)) as { default?: { schema: { safeParse(value: unknown): { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[]; message: string }[] } } } } };
      if (!exported.default || !core.isConfigDeclaration(exported.default)) {
        console.error(`  ${namespace}: module.config.ts does not export defineConfig({ … }); skipped`);
        continue;
      }
      const patch: Record<string, unknown> = {};
      const sources: string[] = [];
      for (const [setting, { variable, type }] of Object.entries(fields)) {
        const raw = read(variable);
        if (raw === undefined) continue;
        patch[setting] = coerce(raw, type);
        sources.push(`${setting} ← ${variable}`);
      }
      if (sources.length === 0) {
        console.log(`  ${namespace}: nothing set for ${Object.values(fields).map((field) => field.variable).join(", ")}; the schema defaults stay`);
        continue;
      }
      const stored = await store.load(namespace);
      const candidate = { ...stored?.values, ...patch };
      const parsed = exported.default.schema.safeParse(candidate);
      if (!parsed.success) {
        console.error(`  ${namespace}: refused by the schema — ${parsed.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
        process.exitCode = 1;
        continue;
      }
      console.log(`  ${namespace}: ${sources.join(", ")}${options.dryRun ? " (dry run)" : ""}`);
      if (options.dryRun) continue;
      await store.save(namespace, parsed.data as Record<string, unknown>, stored?.version ?? 0, { id: "config:import", label: `from ${envFile}` });
      written++;
    }
  } finally {
    await store.dispose?.();
  }
  console.log(`${written} namespace(s) written for APP_ENV=${appEnv}` + (written ? "; the variables can leave the env file now" : ""));
}

async function openStore(
  rootDir: string,
  appEnv: string,
  read: (name: string) => string | undefined,
  core: { FileSettingsStore: new (rootDir: string, appEnv: string) => StoreLike },
): Promise<StoreLike | undefined> {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { tulipes?: { providers?: { settings?: string } } };
  const declared = pkg.tulipes?.providers?.settings;
  if (!declared) return new core.FileSettingsStore(rootDir, appEnv);
  if (!declared.startsWith("@tulipes/mongoose")) {
    console.error(`the app declares settings provider "${declared}", which this command cannot write to — set the values through the console once the app runs`);
    process.exitCode = 2;
    return undefined;
  }
  const uri = read("MONGO_URI");
  if (!uri) {
    console.error("MONGO_URI is not set in the env file or the process; the Mongo settings store needs it");
    process.exitCode = 2;
    return undefined;
  }
  const mongoose = await importFromApp<{ createConnection(uri: string, options: Record<string, unknown>): { asPromise(): Promise<unknown>; close(): Promise<void> } }>(rootDir, "mongoose");
  const provider = await importFromApp<{ MongoSettingsStore: new (connection: unknown) => StoreLike }>(rootDir, "@tulipes/mongoose");
  if (!mongoose || !provider) {
    console.error("mongoose and @tulipes/mongoose must be installed in the app");
    process.exitCode = 2;
    return undefined;
  }
  const connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5_000 });
  await connection.asPromise();
  const store = new provider.MongoSettingsStore(connection);
  const dispose = store.dispose?.bind(store);
  store.dispose = async () => { await dispose?.(); await connection.close(); };
  return store;
}

function coerce(raw: string, type: string): unknown {
  switch (type) {
    case "number": return Number(raw);
    case "boolean": return /^(1|true|yes|on)$/i.test(raw.trim());
    default: return raw;
  }
}

/** `KEY=value` lines, quotes and inline comments removed — what dotenv reads, without dotenv. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    const quoted = /^(["'])((?:(?!\1).)*)\1/.exec(value);
    if (quoted) value = quoted[2]!;
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]!] = value;
  }
  return values;
}
