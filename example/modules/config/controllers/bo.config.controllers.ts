import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { SettingsConflictError, SettingsValidationError } from "@tulipes/core/config";
import { HttpError, ValidationError } from "@tulipes/core/http";

import { auditChange, auditOutcome, type AuditOutcome } from "../helpers/audit.ts";
import { describeModule, describeRoles } from "../helpers/describe.ts";

/**
 * The console: what every module is configured with, and the one write —
 * a settings patch, validated by the module's schema, refused on a stale
 * version, audited before it lands, applied in this process at once and
 * in every other replica through the store's watch. Nothing here edits
 * the environment: a variable is what boot needs before the store answers
 * or a secret, and neither is edited at runtime.
 */
export class BoConfigController {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  /** Every module, in load order. */
  app(): RequestHandler {
    return (_req: Request, res: Response) => {
      res.respond({
        data: {
          app: this.#ctx.config.app ?? {},
          store: this.#ctx.settings.status(),
          roles: describeRoles(this.#ctx),
          modules: this.#ctx.modules.map((module) => describeModule(this.#ctx, module.name)),
        },
      });
    };
  }

  module(): RequestHandler {
    return (req: Request, res: Response) => {
      const described = describeModule(this.#ctx, String(req.params.module));
      if (!described) throw new HttpError(404, "noSuchModule", { field: "module" });
      res.respond({ data: described });
    };
  }

  change(): RequestHandler {
    return async (req: Request, res: Response) => {
      const namespace = String(req.params.module);
      const { values, version } = req.body as { values: Record<string, unknown>; version: number };
      if (!this.#ctx.settings.namespaces().includes(namespace)) {
        throw new HttpError(404, "noSuchModule", { field: "module" });
      }

      const current = this.#ctx.settings.describe(namespace).stored.version;
      if (version !== current) {
        throw new HttpError(409, "staleVersion", {
          code: "STALE_VERSION",
          vars: { version: String(version), current: String(current) },
          details: { current },
          defaultMessage: `version ${version} is stale; the store holds version ${current}`,
        });
      }

      // Acknowledged before anything changes: identifiers only, never values.
      await auditChange(this.#ctx, req, { module: namespace, keys: Object.keys(values), version: current });

      const user = req.auth.user!;
      const outcome = (result: AuditOutcome, written?: number) =>
        auditOutcome(this.#ctx, req, { module: namespace, keys: Object.keys(values), version: written ?? current, outcome: result });
      try {
        const written = await this.#ctx.settings.set(namespace, values, { id: String(user._id), label: user.email });
        await outcome(written.onChangeFailed ? "applied_on_change_failed" : "applied", written.version);
        const action = written.onChangeFailed ? "on_change_failed" : written.requiresRestart.length > 0 ? "restart_required" : undefined;
        res.respond({
          data: { module: namespace, values: written.values, version: written.version, requires_restart: written.requiresRestart },
          ...(action && { meta: { action } }),
        });
      } catch (error) {
        await outcome(error instanceof SettingsValidationError ? "refused" : error instanceof SettingsConflictError ? "conflict" : "failed");
        if (error instanceof SettingsValidationError) {
          throw new ValidationError(error.issues.map((issue) => ({ field: issue.path.map(String).join(".") || "values", message: issue.message })));
        }
        if (error instanceof SettingsConflictError) {
          throw new HttpError(409, "staleVersion", {
            code: "STALE_VERSION",
            vars: { version: String(error.expectedVersion), current: String(error.current?.version ?? 0) },
            details: { current: error.current?.version ?? 0 },
            defaultMessage: error.message,
          });
        }
        throw error;
      }
    };
  }
}
