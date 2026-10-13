import type { RuntimeCtx } from "@tulipes/core/boot";

import { configuredLogStreams } from "../helpers/log-stream.ts";

/**
 * An open log stream is a response that never ends on its own. `ctx.signal`
 * aborts the moment shutdown begins, before HTTP stops accepting, so the
 * streams end while the server is still draining ordinary requests.
 */
export default function logStreams(ctx: RuntimeCtx): void {
  ctx.signal.addEventListener("abort", () => configuredLogStreams(ctx).drain(), { once: true });
}
