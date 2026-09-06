import type { Ctx } from "@tulipes/core/boot";
import type { Request } from "express";

import { moduleLogger } from "@app/core";

/**
 * Every consequential settings action leaves a record.
 *
 * Logged at `warn` deliberately: above the default `info`, so an audit
 * entry survives a deployment that raises LOG_LEVEL to quiet ordinary
 * request logs, and `?level=warn` on the log stream shows the audit trail
 * and nothing else. It rides the app's normal log file from there, so it
 * ships off the box with everything else.
 *
 * A secret's value is NEVER recorded, in either direction. That an audit
 * entry can reconstruct a rotated key would defeat rotating it.
 */
export type AuditAction =
  | "variable.changed"
  | "variable.revealed"
  | "i18n.changed"
  | "reboot.requested";

export interface AuditDetails {
  variable?: string;
  module?: string;
  locale?: string;
  from?: unknown;
  to?: unknown;
  /** Set when the values are withheld because the variable is a secret. */
  redacted?: boolean;
  [key: string]: unknown;
}

export function audit(
  ctx: Ctx,
  req: Request,
  action: AuditAction,
  details: AuditDetails = {},
): void {
  const { user } = req.auth;

  moduleLogger(ctx.Environment, "settings", ctx.mode).warn(
    {
      action,
      actor: user ? String(user._id) : "unknown",
      actor_role: user?.role,
      ip: req.ip,
      app_env: ctx.Environment.appEnv,
      ...details,
    },
    `settings: ${action}`,
  );
}
