import type { BootstrapCleanup } from "@tulipes/core/boot";

import { closeCache } from "../helpers/cache/index.js";

/**
 * The app cache opens lazily on first use, so there is nothing to open here;
 * what this bootstrap contributes is the cleanup: the redis driver holds a
 * connection, and core runs this after traffic drains, in reverse load order.
 */
export default function cache(): BootstrapCleanup {
  return () => closeCache();
}
