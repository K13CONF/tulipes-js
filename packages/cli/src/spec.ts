import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { importFromApp } from "./app-core.js";
import { inspectApp } from "./inspection.js";

/**
 * `tulipes spec` — an OpenAPI document and/or a Postman collection, built
 * from the app's declared routes through the same inspection boot as
 * `tulipes routes`: no service, no secret, no listener.
 *
 * The generator lives in `@tulipes/spec`, imported lazily: core carries no
 * dependency on it, and an app that never generates a spec never installs
 * it.
 */
export interface SpecOptions {
  openapi?: string;
  postman?: string;
  /** Base URL the documents advertise. */
  url?: string;
}

interface SpecModule {
  extract(ctx: unknown): unknown;
  toOpenApi(source: unknown, options: unknown): Promise<{ document: unknown; warnings: string[] }>;
  toPostman(source: unknown, options: unknown): Promise<{ document: unknown; warnings: string[] }>;
}

export async function runSpec(rootDir: string, options: SpecOptions): Promise<void> {
  if (!options.openapi && !options.postman) {
    console.error(
      [
        "nothing to write — name at least one output:",
        "",
        "  tulipes spec --openapi openapi.json",
        "  tulipes spec --postman collection.json",
        "  tulipes spec --openapi openapi.json --postman collection.json --url https://api.example.com",
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }

  const spec = await loadGenerator(rootDir);
  if (!spec) return;

  const handle = await inspectApp(rootDir);

  try {
    const source = spec.extract(handle.ctx) as { routes: unknown[]; folders: string[] };
    if (source.routes.length === 0) {
      console.log("no routes declared — nothing to describe");
      return;
    }

    const url = options.url ?? defaultUrl(handle.env);
    const warnings = new Set<string>();

    if (options.openapi) {
      const { document, warnings: issues } = await spec.toOpenApi(source, { servers: [url] });
      issues.forEach((issue) => warnings.add(issue));
      write(options.openapi, document);
    }

    if (options.postman) {
      const { document, warnings: issues } = await spec.toPostman(source, { baseUrl: url });
      issues.forEach((issue) => warnings.add(issue));
      write(options.postman, document);
    }

    console.log(
      `\n${source.routes.length} endpoint(s) across ${source.folders.length} folder(s): ` +
        source.folders.join(", "),
    );

    // A schema that produced no shape still documents the endpoint, so
    // this is a warning and not a failure — but it is worth saying,
    // because the document is quietly less useful than it looks.
    if (warnings.size > 0) {
      console.warn(`\n${warnings.size} schema(s) could not be described:`);
      for (const warning of warnings) console.warn(`  ! ${warning}`);
    }
  } finally {
    await handle.shutdown();
  }
}

/**
 * Loads the generator **from the app**, not from wherever this CLI lives.
 *
 * `tulipes` is normally installed globally, so a bare `import("@tulipes/spec")`
 * resolves against the CLI's own node_modules and misses the copy the app
 * just installed — reporting it as absent while it sits right there. The
 * app's own resolution root is the only one that can be right.
 */
async function loadGenerator(rootDir: string): Promise<SpecModule | undefined> {
  for (const load of [() => fromApp(rootDir), fromCli]) {
    const spec = await load();
    if (spec) return spec;
  }

  console.error(
    [
      "`tulipes spec` needs the generator package:",
      "",
      "  pnpm add -D @tulipes/spec",
      "",
      "It is separate so an app that never generates a spec never installs it.",
    ].join("\n"),
  );
  process.exitCode = 2;
  return undefined;
}

const fromApp = (rootDir: string): Promise<SpecModule | undefined> =>
  importFromApp<SpecModule>(rootDir, "@tulipes/spec");

/** A locally installed CLI, or a hoisted layout, resolves it directly. */
async function fromCli(): Promise<SpecModule | undefined> {
  try {
    return (await import("@tulipes/spec")) as unknown as SpecModule;
  } catch {
    return undefined;
  }
}

/** Whatever the app itself would be reachable at, so the document is usable as written. */
function defaultUrl(env: { store: { has(name: string): boolean }; get(name: string): unknown }): string {
  const port = env.store.has("PORT") ? Number(env.get("PORT")) : 3000;
  const domain = env.store.has("PUBLIC_DOMAIN") ? String(env.get("PUBLIC_DOMAIN")) : "localhost";

  return domain === "localhost" ? `http://localhost:${port}` : `https://${domain}`;
}

function write(target: string, document: unknown): void {
  const path = resolve(target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`  wrote ${target}`);
}
