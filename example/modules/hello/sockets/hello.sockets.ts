import type { Ctx } from "@tulipes/core/boot";
import type { SocketRegistry } from "@tulipes/socket.io";

/**
 * Backend mode only. A namespace is claimed by exactly one module; emit
 * from anywhere with `ctx.sockets!.of("/hello")`.
 *
 * Try it: wscat -c ws://localhost:3000/hello
 */
export default function helloSockets({ config }: Ctx, sockets: SocketRegistry): void {
  sockets.namespace("/hello", (nsp) => {
    nsp.on("connection", (socket) => {
      socket.emit("greeting", {
        message: config.hello?.greeting,
        online: nsp.sockets.size,
      });

      socket.on("ping", (ack: (reply: string) => void) => ack("pong"));
    });
  });
}
