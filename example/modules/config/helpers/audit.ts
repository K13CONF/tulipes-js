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
