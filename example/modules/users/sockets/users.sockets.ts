import type { Ctx } from "@forgex/core/boot";
import type { SocketRegistry } from "@forgex/core/sockets";

export default function usersSockets({ config }: Ctx, sockets: SocketRegistry): void {
  sockets.namespace("/users", (nsp) => {
    nsp.on("connection", (socket) => {
      socket.emit("welcome", {
        module: "users",
        signupMode: config.users?.signupMode,
        online: nsp.sockets.size,
      });

      socket.on("whoami", (ack: (reply: { id: string }) => void) => {
        ack({ id: socket.id });
      });
    });
  });
}
