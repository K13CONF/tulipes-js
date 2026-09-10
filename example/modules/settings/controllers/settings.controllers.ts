import { join } from "node:path";
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";
import { coerceValue, type DescribedVariable } from "@tulipes/core/env";

import { audit } from "../helpers/audit.js";
import {
  MAX_SETTINGS_FILE_BYTES,
  missingTranslationKeys,
  readSettingsJson,
  settingsFileNames,
  settingsJson,
  writeSettingsFile,
} from "../helpers/files.js";
import { writeVariable } from "../helpers/env-file.js";
import { LogStreams } from "../helpers/log-stream.js";
import { isSupervised, restartAfterResponse } from "../helpers/pm2.js";

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
  readonly #logStreams = new LogStreams();
  constructor(private readonly ctx: Ctx) {}

  /** Every module, with everything the framework knows about it. */
  modules(): RequestHandler {
    return async (_req: Request, res: Response) => {
      const variables = this.ctx.Environment.store.describe();
      const routes = [...this.ctx.routes.all()];
      const grants = this.ctx.acl?.describe() ?? [];
      const i18nBudget = { bytes: 0, keys: 0 };

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
          i18n: this.#i18nOf(manifest.dir, i18nBudget),
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
        await audit(this.ctx, req, {
          action: "variable.reveal_requested",
          variable: name,
        });
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
        throw new HttpError(422, coerced.reason, {
          field: "value",
          code: "INVALID_VALUE",
        });
      }

      await audit(this.ctx, req, {
        action: "variable.change_requested",
        variable: name,
      });
      const { replaced } = writeVariable(
        this.ctx.Environment.envFile,
        name,
        value,
      );

      // A container-injected variable outranks the file on the next boot
      // too, so the file alone would silently change nothing. Setting it
      // live makes the change real for THIS process — and only this one.
      const shadowed = found.source === "process.env";
      if (shadowed) process.env[name] = value;

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

      res.respond({
        data: { module, locale, translations: readSettingsJson(file) },
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

      readSettingsJson(file);
      const translations = settingsJson(req.body.translations);
      await audit(this.ctx, req, {
        action: "i18n.change_requested",
        module,
        locale,
        keys: Object.keys(translations).length,
      });
      writeSettingsFile(file, `${JSON.stringify(translations, null, 2)}\n`);

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

      // An accepted request still needs its durable audit before PM2 is contacted.
      await audit(this.ctx, req, {
        action: "reboot.requested",
        target_count: targets?.length ?? 0,
      });

      // The helper owns validation, response completion and deferred execution.
      await restartAfterResponse(res, targets ?? []);
    };
  }

  /**
   * Server-Sent Events over the log files.
   *
   * SSE rather than a socket: a log tail is one-way, it is plain HTTP so it
   * passes the RAI gate like every other endpoint, and the browser
   * can reconnect using a client that sends the required Authorization header.
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
      const level =
        typeof req.query.level === "string" ? req.query.level : undefined;
      const tail = Math.min(Number(req.query.tail ?? 200) || 0, 1000);

      const session = req.auth.session;
      this.#logStreams.open(res, {
        userId: req.auth.user ? String(req.auth.user._id) : "",
        expiresAt: session
          ? Math.min(
              session.access_expires_at.getTime(),
              session.expires_at.getTime(),
            )
          : 0,
        dir: String(this.ctx.Environment.get("LOG_DIR")),
        prefix: `${String(this.ctx.Environment.get("LOG_BASENAME"))}-${which}`,
        process: which,
        tail,
        ...(level ? { level } : {}),
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
    if (!manifest)
      throw new HttpError(404, "noSuchModule", { field: "module" });
    if (!/^[a-z]{2}(-[A-Za-z0-9]+)?$/.test(locale)) {
      throw new HttpError(422, "invalidLocale", { field: "locale" });
    }

    return {
      file: join(manifest.dir, "i18n", `${locale}.json`),
      module,
      locale,
    };
  }

  #i18nOf(
    moduleDir: string,
    budget: { bytes: number; keys: number },
  ): { locales: string[]; missing: Record<string, string[]> } {
    const i18nDir = join(moduleDir, "i18n");
    const files = settingsFileNames(i18nDir).filter((name) =>
      /^[a-z]{2}(-[A-Za-z0-9]+)?(\.missing)?\.json$/.test(name),
    );
    const locales = files
      .filter((name) => !name.endsWith(".missing.json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();

    // The gap list the framework already writes outside production — what
    // a translator still owes, without recomputing it here.
    const missing: Record<string, string[]> = {};
    for (const name of files.filter((file) => file.endsWith(".missing.json"))) {
      const locale = name.replace(/\.missing\.json$/, "");
      const keys = missingTranslationKeys(
        readSettingsJson(join(i18nDir, name)),
      );
      budget.keys += keys.length;
      budget.bytes += keys.reduce(
        (total, key) => total + Buffer.byteLength(key),
        0,
      );
      if (budget.keys > 10_000 || budget.bytes > MAX_SETTINGS_FILE_BYTES) {
        throw new HttpError(413, "settingsMetadataTooLarge", {
          code: "SETTINGS_METADATA_TOO_LARGE",
          defaultMessage:
            "The missing translation key summary exceeds the allowed size",
        });
      }
      missing[locale] = keys;
    }

    return { locales, missing };
  }
}

/**
 * The full spec travels with every variable: a console needs the type,
 * the enum and whether it is required to render a usable form, not just
 * the current value.
 */
function describeVariable(
  variable: DescribedVariable,
): Record<string, unknown> {
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
    .filter(
      ({ resource }) =>
        resource === id || resource === "*" || resource === namespace,
    )
    .map(({ role }) => role);
  return [...new Set(roles)].sort();
}
