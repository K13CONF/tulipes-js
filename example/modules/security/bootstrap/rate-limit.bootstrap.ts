import type { BootstrapCleanup, RuntimeCtx } from "@tulipes/core/boot";

import { closeRateLimits } from "../helpers/rate-limit.js";

/** The rate limiters open their Redis client on first use; this returns the close. */
export default function rateLimits(ctx: RuntimeCtx): BootstrapCleanup {
  return () => closeRateLimits(ctx);
}
