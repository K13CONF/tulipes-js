import type { ConfigCtx, Ctx } from "@tulipes/core/boot";
import { closeRateLimits } from "./helpers/rate-limit.js";

// Preserve app-level security settings, including the password cost factor.
export default function securityConfig({ config }: ConfigCtx): Record<string, unknown> {
  return { ...config.security };
}

export function onShutdown({ Environment }: Ctx): void { closeRateLimits(Environment); }
