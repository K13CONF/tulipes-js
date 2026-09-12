import type { Provider } from "../boot/providers.js";

/**
 * `@tulipes/core/sockets` moved to `@tulipes/socket.io`. What remains is the
 * migration diagnostic: an app still declaring this subpath as its sockets
 * provider gets one boot error naming the fix, and `SocketRegistry`/`SocketsFn`
 * imports fail with "no exported member" — see MIGRATING.md.
 */
const moved: Provider<"sockets"> = {
  contract: 1,
  capability: "sockets",
  name: "core/sockets (moved)",
  async acquire(_ctx, report) {
    report.add({
      scope: "providers",
      message: '"@tulipes/core/sockets" no longer contains the Socket.IO provider — install @tulipes/socket.io, declare "tulipes": { "providers": { "sockets": "@tulipes/socket.io" } } and import SocketRegistry/SocketsFn from it',
    });
    return undefined;
  },
};

export default moved;
