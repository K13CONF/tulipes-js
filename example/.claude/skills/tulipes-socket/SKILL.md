---
name: tulipes-socket
description: Use when adding realtime features to a Tulipes app — websockets, live updates, presence, notifications — or when emitting events from a route or background job. Covers the sockets contract and namespace ownership.
---

# Adding realtime

Socket.IO namespaces are claimed by modules, one owner each, in
`modules/<name>/sockets/*.sockets.ts`. Websockets are opt-in: an app with
no socket files starts no Socket.IO server at all.

```ts
import type { Ctx } from "@tulipes/core/boot";
import type { SocketRegistry } from "@tulipes/core/sockets";

export default function billingSockets({ config }: Ctx, sockets: SocketRegistry): void {
  sockets.namespace("/billing", (nsp) => {
    nsp.on("connection", (socket) => {
      socket.emit("ready", { plan: config.billing?.plan });

      socket.on("subscribe", (invoiceId: string) => {
        socket.join(`invoice:${invoiceId}`);
      });
    });
  });
}
```

Emit from anywhere with the context — a route, a bootstrap task, a queue
processor in the backend process:

```ts
ctx.sockets!.of("/billing").to(`invoice:${id}`).emit("invoice:paid", payload);
```

## Rules

- **Namespaces are claimed once.** A second module claiming `/billing`
  crashes the boot naming both.
- `sockets.of()` throws on a namespace nobody claimed. Socket.IO's raw
  `io.of()` would silently create it and emit into the void — use the
  framework accessor so typos surface.
- Sockets exist in **backend mode only**. `ctx.sockets` is undefined in the
  worker process, so a queue processor cannot emit directly — publish to
  Redis, or have the backend process subscribe.
- Namespace names are lowercase kebab-case with a leading slash.

## Gotchas

- Authenticate in namespace middleware (`nsp.use(...)`), not per event —
  the framework's HTTP pipeline does not run for socket connections.
- Scaling past one backend process needs the Socket.IO Redis adapter;
  otherwise an emit only reaches clients connected to that instance.
- Socket handlers run outside the request pipeline: no `HttpError`, no
  request logging. Handle failures explicitly and emit an error event.
