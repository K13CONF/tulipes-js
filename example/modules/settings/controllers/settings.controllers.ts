import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";
import { coerceValue, type DescribedVariable } from "@tulipes/core/env";

import { audit } from "../helpers/audit.js";
import { writeVariable } from "../helpers/env-file.js";
import { tailLogs } from "../helpers/log-tail.js";
import { isSupervised, restart } from "../helpers/pm2.js";

/**
 * The infrastructure console: what every module declares, what its
 * variables currently resolve to and from where, its translations, and a
 * live view of the logs.
 *
 * Everything here is reachable only by `sysadmin` — see module.acl.ts.
 * Nothing is invented: it all comes from the booted context, so the
 * console cannot describe an app different from the one running.
 */
export class SettingsController {
  constructor(private readonly ctx: Ctx) {}

  /** Every module, with everything the framework knows about it. */
  modules(): RequestHandler {
    return async (_req: Request, res: Response) => {
      const variables = this.ctx.Environment.store.describe();
      const routes = [...this.ctx.routes.all()];
      const grants = this.ctx.acl?.describe() ?? [];

      // ctx.modules is the authoritative list. Deriving it from config
      // keys instead would invent modules out of the app-level seed —
      // "pagination" and "i18n" are settings, not features.
      const modules = this.ctx.modules.map((manifest) => {
        const { name } = manifest;
        return {
          name,
          package_name: manifest.packageName,
          tier: manifest.tier,
          priority: manifest.priority,
          depends_on: manifest.dependsOn,
          variables: variables
            .filter((variable) => variable.owner === name)
            .map(describeVariable),
          config: this.ctx.config[name] ?? null,
          i18n: this.#i18nOf(manifest.dir),
          routes: routes
            .filter((route) => route.module === name)
            .map((route) => ({
              id: route.info.id,
              method: route.method,
              path: route.path,
              name: route.info.name ?? null,
              description: route.info.description ?? null,
              folder: route.info.folder ?? route.module,
              roles: rolesFor(grants, route.info.id),
            })),
        };
      });

      res.respond({
        data: {
          app_env: this.ctx.Environment.appEnv,
          env_file: this.ctx.Environment.envFile,
          supervised: isSupervised(),
          modules,
        },
        meta: { total_items: modules.length },
      });
    };
  }

  /** One variable. `?reveal=true` returns a secret's value, and is audited. */
  variable(): RequestHandler {
    return async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const reveal = req.query.reveal === "true";

      const found = this.ctx.Environment.store
        .describe({ revealSecrets: reveal })
        .find((variable) => variable.spec.name === name);
      if (!found) throw new HttpError(404, "noSuchVariable", { field: "name" });

      if (reveal && found.isSecret) {
        audit(this.ctx, req, "variable.revealed", { variable: name });
      }

      res.respond({ data: describeVariable(found) });
    };
  }

  /**
   * Sets a variable's value for this deployment.
   *
   * Always writes the env file — never `meta.variables.json`, which is the
   * module's committed contract and would change the default for every
   * environment while being lost on the next deploy.
   */
  setVariable(): RequestHandler {
    return async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const { value } = req.body as { value: string };

      const found = this.ctx.Environment.store
        .describe()
        .find((variable) => variable.spec.name === name);
      if (!found) throw new HttpError(404, "noSuchVariable", { field: "name" });

      // Validated against the module's own spec, so an out-of-range enum
      // or a non-numeric number is refused here rather than crashing the
      // next boot — which is when it would otherwise surface.
      const coerced = coerceValue(found.spec, value);
      if (!coerced.ok) {
        throw new HttpError(422, coerced.reason, { field: "value", code: "INVALID_VALUE" });
      }

      const { replaced } = writeVariable(this.ctx.Environment.envFile, name, value);

      // A container-injected variable outranks the file on the next boot
      // too, so the file alone would silently change nothing. Setting it
      // live makes the change real for THIS process — and only this one.
      const shadowed = found.source === "process.env";
      if (shadowed) process.env[name] = value;

      audit(this.ctx, req, "variable.changed", {
        variable: name,
        redacted: found.isSecret,
        ...(found.isSecret ? {} : { from: found.value, to: coerced.value }),
      });

      res.respond({
        data: {
          name,
          written_to: this.ctx.Environment.envFile,
          created: !replaced,
          requires_reboot: true,
        },
        meta: {
          action: shadowed ? "restart_required_shadowed" : "restart_required",
        },
      });
    };
  }

  /** A module's translations for one locale. */
  translations(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { file, module, locale } = this.#localeFile(req);
      if (!existsSync(file)) throw new HttpError(404, "noSuchLocale", { field: "locale" });

      res.respond({
        data: { module, locale, translations: readJson(file) },
      });
    };
  }

  /**
   * Replaces a locale's translations. New keys are accepted: filling the
   * gaps the framework records in `<locale>.missing.json` is the point.
   */
  setTranslations(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { file, module, locale } = this.#localeFile(req);
      if (!existsSync(file)) throw new HttpError(404, "noSuchLocale", { field: "locale" });

      const { translations } = req.body as { translations: Record<string, unknown> };
      writeFileSync(file, `${JSON.stringify(translations, null, 2)}\n`);

      audit(this.ctx, req, "i18n.changed", {
        module,
        locale,
        keys: Object.keys(translations).length,
      });

      // i18next loaded its resources at boot, so this file is not consulted
      // again until the process restarts.
      res.respond({
        data: { module, locale, requires_reboot: true },
        meta: { action: "restart_required" },
      });
    };
  }

  /** Restarts the app's processes so written values take effect. */
  reboot(): RequestHandler {
    return async (req: Request, res: Response) => {
      const { targets } = (req.body ?? {}) as { targets?: string[] };

      if (!isSupervised()) {
        throw new HttpError(503, "notSupervised", {
          code: "NOT_SUPERVISED",
          defaultMessage:
            "not running under PM2 — restart manually for changes to take effect",
        });
      }

      audit(this.ctx, req, "reboot.requested", { targets: targets ?? "all" });

      const outcome = await restart(targets ?? []);
      res.respond({ data: outcome });
    };
  }

  /**
   * Server-Sent Events over the log files.
   *
   * SSE rather than a socket: a log tail is one-way, it is plain HTTP so it
   * passes the RAI gate like every other endpoint, and the browser
   * reconnects on its own.
   */
  logStream(): RequestHandler {
    return async (req: Request, res: Response) => {
      if (!Boolean(this.ctx.Environment.get("LOG_FILE"))) {
        throw new HttpError(409, "fileLoggingDisabled", {
          code: "FILE_LOGGING_DISABLED",
          defaultMessage: "LOG_FILE is off — there are no log files to stream",
        });
      }

      const which = req.query.process === "worker" ? "worker" : "backend";
      const level = typeof req.query.level === "string" ? req.query.level : undefined;
      const tail = Math.min(Number(req.query.tail ?? 200) || 0, 1000);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // nginx buffers proxied responses by default, which would hold
        // every event until the buffer fills — this turns that off.
        "X-Accel-Buffering": "no",
      });

      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const wanted = level ? LEVELS[level] ?? 0 : 0;
      const stream = tailLogs({
        dir: String(this.ctx.Environment.get("LOG_DIR")),
        prefix: `${String(this.ctx.Environment.get("LOG_BASENAME"))}-${which}`,
        tail,
        onLine: (line) => {
          // Lines are JSON from pino; anything else is a stray write and
          // is passed through as a raw message rather than dropped.
          try {
            const entry = JSON.parse(line) as { level?: number };
            if ((entry.level ?? 0) < wanted) return;
            send("log", entry);
          } catch {
            send("log", { msg: line });
          }
        },
      });

      // Proxies drop an idle connection; a comment frame is the standard
      // keep-alive and is ignored by EventSource.
      const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);

      send("ready", { process: which, tail, level: level ?? "all" });

      req.on("close", () => {
        clearInterval(heartbeat);
        stream.close();
      });
    };
  }

  #localeFile(req: Request): { file: string; module: string; locale: string } {
    const module = String(req.params.module);
    const locale = String(req.params.locale);

    // Resolved from the manifest, never built from the request: the
    // directory comes from what the framework discovered at boot, so a
    // crafted module or locale name cannot address a path outside it.
    const manifest = this.ctx.modules.find((entry) => entry.name === module);
    if (!manifest) throw new HttpError(404, "noSuchModule", { field: "module" });
    if (!/^[a-z]{2}(-[A-Za-z0-9]+)?$/.test(locale)) {
      throw new HttpError(422, "invalidLocale", { field: "locale" });
    }

    return { file: join(manifest.dir, "i18n", `${locale}.json`), module, locale };
  }

  #i18nOf(moduleDir: string): { locales: string[]; missing: Record<string, string[]> } {
    const i18nDir = join(moduleDir, "i18n");
    if (!existsSync(i18nDir)) return { locales: [], missing: {} };

    const files = readdirSync(i18nDir).filter((name) => name.endsWith(".json"));
    const locales = files
      .filter((name) => !name.endsWith(".missing.json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();

    // The gap list the framework already writes outside production — what
    // a translator still owes, without recomputing it here.
    const missing: Record<string, string[]> = {};
    for (const name of files.filter((file) => file.endsWith(".missing.json"))) {
      const locale = name.replace(/\.missing\.json$/, "");
      missing[locale] = flattenKeys(readJson(join(i18nDir, name)));
    }

    return { locales, missing };
  }
}

/** pino's numeric levels, for filtering a stream by severity. */
const LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * The full spec travels with every variable: a console needs the type,
 * the enum and whether it is required to render a usable form, not just
 * the current value.
 */
function describeVariable(variable: DescribedVariable): Record<string, unknown> {
  const { spec } = variable;
  return {
    name: spec.name,
    type: spec.type,
    description: spec.description,
    group: spec.group ?? null,
    required: spec.required ?? false,
    enum: spec.enum ?? null,
    default: spec.type === "secret" ? null : (spec.default ?? null),
    owner: variable.owner,
    // Which of the three sources won, and therefore whether a write here
    // can take effect at all.
    source: variable.source,
    is_secret: variable.isSecret,
    is_set: variable.isSet,
    value: variable.value ?? null,
  };
}

function rolesFor(
  grants: { role: string; resource: string }[],
  id: string,
): string[] {
  const namespace = `${id.split(":")[0]}:*`;
  const roles = grants
    .filter(({ resource }) => resource === id || resource === "*" || resource === namespace)
    .map(({ role }) => role);
  return [...new Set(roles)].sort();
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** `{ list: { empty: "…" } }` → `["list.empty"]`. */
function flattenKeys(source: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(source).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value)
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}
