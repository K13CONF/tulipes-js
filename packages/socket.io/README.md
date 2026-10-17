<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.13.1/assets/brand/lockup-bloom.svg" alt="tulipesjs" width="340">

</div>

# @tulipes/socket.io

The Socket.IO **sockets provider** for [Tulipes](https://www.npmjs.com/package/@tulipes/core)
apps. Every module's `sockets/*.sockets.ts` claims its namespace on one
Socket.IO server that core attaches to the backend's HTTP server just before it
listens. Core itself no longer installs Socket.IO; an app without realtime
features declares no provider and never pays for one.

Requires Node 24.x and a core that ships the provider contract with
`situations` and `attach`. `socket.io` is this package's own dependency.

## Select it

```jsonc
{ "tulipes": { "providers": { "sockets": "@tulipes/socket.io" } } }
```

A `sockets/` directory requires the provider automatically; a module that only
emits declares `"tulipes": { "requires": ["sockets"] }`. Installing this package
without the declaration selects nothing.

## Use it

```ts
// modules/billing/sockets/billing.sockets.ts
import type { Ctx } from "@tulipes/core/boot";
import type { SocketRegistry } from "@tulipes/socket.io";

export default function billingSockets(ctx: Ctx, sockets: SocketRegistry): void {
  sockets.namespace("/billing", (nsp) => nsp.on("connection", (socket) => socket.emit("ready")));
}

// anywhere in the backend after acquisition
ctx.sockets!.of("/billing").emit("invoice", { id });
```

## Behavior

- Backend only (`situations: ["backend"]`): worker, script and inspection boots
  report the provider as not used and never import a socket file.
- Namespaces are claimed during acquisition on an unattached server; core
  attaches the HTTP server after routes mount and before `listen()`, so no
  client can reach an unwired namespace. An attach failure is a boot error.
- Shutdown: the server closes in the drain phase alongside the HTTP drain,
  disconnecting clients and releasing the listener as before.
- A namespace is claimed by exactly one module; `of()` throws on unclaimed
  names; names are `/` or `/kebab-case`.

## Versions

`0.1.0-rc.1` requires core `^0.10.0-rc.2`, the candidate that added the
`situations`/`attach` contract; install both with `@next`. See core's
[MIGRATING.md](https://github.com/K13CONF/tulipes-js/blob/v0.10.0-rc.2/packages/core/MIGRATING.md#0100-rc2--declare-the-sockets-provider).
