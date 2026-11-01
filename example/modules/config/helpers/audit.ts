import type { Request } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

/**
 * Persist before applying a change, independent of LOG_LEVEL and with a
 * majority acknowledgment: a write nobody can account for is worse than a
 * write that did not happen. Only identifiers enter the record — the
 * namespace, the field names, the version the caller read — never values.
 * Failure is deliberately terminal: the caller awaits this before acting.
 */
export async function auditChange(
  ctx: Ctx,
  req: Request,
  change: { module: string; keys: string[]; version: number },
): Promise<void> {
  const user = req.auth.user;
  if (!user) throw new HttpError(401, "unauthenticated");

  try {
    const Audit = ctx.models!.get("ConfigAudit");
    await new Audit({
      action: "settings.change_requested",
      module: change.module,
      keys: change.keys,
      version: change.version,
      actor: String(user._id),
      actor_role: user.role,
      ip: req.ip,
      request_id: req.client.requestId,
      app_env: ctx.appEnv,
      mode: ctx.mode,
      recorded_at: new Date(),
    }).save({ w: "majority", j: true, wtimeout: 5000 });
  } catch {
    // Sink/validation errors may contain record content or connection details.
    throw new HttpError(503, "auditUnavailable", {
      code: "AUDIT_UNAVAILABLE",
      defaultMessage: "The audit record could not be acknowledged; the change was not applied",
    });
  }
}

export type AuditOutcome = "applied" | "applied_on_change_failed" | "refused" | "conflict" | "failed";

/**
 * What became of a requested change, recorded after the fact. Best effort:
 * the request record above is the guarantee, and failing the response here
 * would report an error for a write that may have landed.
 */
export async function auditOutcome(
  ctx: Ctx,
  req: Request,
  change: { module: string; keys: string[]; version: number; outcome: AuditOutcome },
): Promise<void> {
  const user = req.auth.user;
  if (!user) return;
  try {
    const Audit = ctx.models!.get("ConfigAudit");
    await new Audit({
      action: "settings.change_completed",
      outcome: change.outcome,
      module: change.module,
      keys: change.keys,
      version: change.version,
      actor: String(user._id),
      actor_role: user.role,
      ip: req.ip,
      request_id: req.client.requestId,
      app_env: ctx.appEnv,
      mode: ctx.mode,
      recorded_at: new Date(),
    }).save({ w: "majority", j: true, wtimeout: 5000 });
  } catch (error) {
    console.error(`[config] the outcome of a ${change.module} change could not be audited: ${(error as Error).name}`);
  }
}
