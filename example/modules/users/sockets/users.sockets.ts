import type { Ctx } from "@tulipes/core/boot";
import type { SocketRegistry } from "@tulipes/socket.io";

export default function usersSockets({ config }: Ctx, sockets: SocketRegistry): void {
  sockets.namespace("/users", (nsp) => {
    nsp.on("connection", (socket) => {
      socket.emit("welcome", {
        module: "users",
        signupMode: config.users?.signupMode,
        online: nsp.sockets.size,
      });

      // A client may emit without a callback: never call one that is not there.
      socket.on("whoami", (ack: unknown) => {
        if (typeof ack === "function") ack({ id: socket.id });
      });
    });
  });
}
