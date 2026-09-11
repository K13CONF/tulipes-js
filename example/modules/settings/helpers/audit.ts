import type { Ctx } from "@tulipes/core/boot";
import type { Request } from "express";
import { HttpError } from "@tulipes/core/http";

/** These are requested actions, not proof that a later side effect succeeded. */
export type AuditEvent =
  | { action: "variable.change_requested"; variable: string }
  | { action: "variable.reveal_requested"; variable: string }
  | {
      action: "i18n.change_requested";
      module: string;
      locale: string;
      keys: number;
    }
  | { action: "reboot.requested"; target_count: number };

/**
 * Persist before revealing secrets or applying changes, independent of LOG_LEVEL.
 * Only identifiers and counts enter the record, never values or request bodies.
 * Failure is deliberately terminal: the caller must await this before acting.
 */
export async function audit(
  ctx: Ctx,
  req: Request,
  event: AuditEvent,
): Promise<void> {
  const user = req.auth.user;
  if (!user) throw new HttpError(401, "unauthorized");

  // Select fields explicitly. Even an untyped caller cannot override actor/action
  // or smuggle from/to values into the record through an arbitrary details object.
  const details =
    event.action === "variable.change_requested" ||
    event.action === "variable.reveal_requested"
      ? { variable: event.variable }
      : event.action === "i18n.change_requested"
        ? { module: event.module, locale: event.locale, keys: event.keys }
        : { target_count: event.target_count };

  try {
    const Audit = ctx.models!.get("AuditEvent");
    await new Audit({
      ...details,
      action: event.action,
      actor: String(user._id),
      actor_role: user.role,
      ip: req.ip,
      app_env: ctx.Environment.appEnv,
      mode: ctx.mode,
      recorded_at: new Date(),
    }).save({ w: "majority", j: true, wtimeout: 5000 });
  } catch {
    // Sink/validation errors may contain record content or connection details.
    throw new HttpError(503, "auditUnavailable", {
      code: "AUDIT_UNAVAILABLE",
      defaultMessage:
        "The audit record could not be acknowledged; the action was not performed",
    });
  }
}
