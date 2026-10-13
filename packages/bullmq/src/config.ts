import type { Ctx } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";

/**
 * Where this package reads how to reach Redis: `config.bullmq.redisUrl`,
 * set by the app's `config/app.config.ts` from the variable its sys module
 * declares — `bullmq: { redisUrl: env.core.redisUrl }`. Core knows nothing
 * of this key; the augmentation types it for any app that compiles this
 * package.
 */
export interface BullmqConfig {
  /** `redis://[user:pass@]host:port[/db]`. Required for the provider. */
  redisUrl: string;
}

declare module "@tulipes/core/config" {
  interface GlobalConfig {
    bullmq?: Partial<BullmqConfig>;
  }
}

/** The key, spelled the way a boot report names it. */
export const REDIS_URL_CONFIG = "config.bullmq.redisUrl";

/**
 * Reached only when the app declared the provider, so a missing URL is a
 * contradiction the boot refuses, naming the key to wire.
 */
export function readRedisUrl(ctx: Pick<Ctx, "config">, report: BootReport): string | undefined {
  const url = ctx.config.bullmq?.redisUrl;
  if (!url) {
    report.add({
      scope: "providers",
      message:
        `provider "bullmq" is selected but ${REDIS_URL_CONFIG} is not set — ` +
        `wire it in config/app.config.ts from a variable a sys module declares: bullmq: { redisUrl: env.core.redisUrl }`,
    });
    return undefined;
  }
  return url;
}
