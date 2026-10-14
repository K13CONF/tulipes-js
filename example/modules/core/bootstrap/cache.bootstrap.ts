import type { BootstrapCleanup, RuntimeCtx } from "@tulipes/core/boot";

import { closeCache, openCache } from "../helpers/cache/index.ts";

/**
 * Open the app cache and wait, bounded, for redis, so the first request and
 * the first job find it ready instead of missing while it connects. The
 * cleanup is the other half: the redis driver holds a connection, and core
 * runs it after traffic drains, in reverse load order. Inspection never
 * runs bootstraps, so nothing connects there.
 */
export default async function cache(ctx: RuntimeCtx): Promise<BootstrapCleanup> {
  await openCache(ctx);
  return () => closeCache();
}
