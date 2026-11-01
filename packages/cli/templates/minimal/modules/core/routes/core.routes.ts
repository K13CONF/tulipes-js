import type { BackendCtx } from "@tulipes/core/boot";

import { clientHeaders } from "../helpers/client-headers.ts";

/**
 * The sys core module loads first, so what it mounts on `ctx.app` runs on
 * every request of every later module: this is the global middleware slot.
 * Here it binds `req.client` from the headers every client sends and echoes
 * X-Request-Id, so a client and the server name the same request.
 */
export default function coreRoutes({ app }: BackendCtx): void {
  app.use(clientHeaders());
}
