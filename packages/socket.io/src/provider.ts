import type { Provider } from "@tulipes/core/boot";

import { initSockets } from "./load-sockets.js";

/**
 * The "sockets" provider an app selects with
 * `"tulipes": { "providers": { "sockets": "@tulipes/socket.io" } }`.
 *
 * Backend only: a worker or script has no HTTP server to attach to and
 * inspection must not wire namespaces, so core skips it there. Namespaces are
 * claimed during acquisition (phase 8) on an unattached server; core hands it
 * the HTTP server through attach() before listen(). Closing it in the drain
 * phase disconnects clients alongside the HTTP drain, exactly as before.
 */
export const provider: Provider<"sockets"> = {
  contract: 2,
  capability: "sockets",
  name: "socket.io",
  situations: ["backend"],
  async acquire({ ctx, files }, report, own) {
    const manager = await initSockets(files, ctx, report, (created) => own({
      attach: (server) => created.attach(server),
      drain: () => created.close(),
      dispose: () => undefined,
      status: () => ({
        label: created.namespaces().join(", ") || "no namespaces claimed",
        ready: true,
      }),
    }));
    return manager;
  },
};
