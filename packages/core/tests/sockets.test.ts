import { io } from "socket.io-client";
import { expect, test } from "vitest";
import { fixture, url } from "./fixture.js";

test("shutdown disconnects Socket.IO clients and releases the HTTP listener", async () => {
  const app = await fixture({
    "modules/probe/sockets/probe.sockets.js": `
      export default (ctx, sockets) => sockets.namespace('/probe', nsp => {
        nsp.on('connection', socket => socket.emit('ready', { message: 'ready' }));
      });
    `,
  });

  const handle = await app.boot();

  const socket = io(url(handle) + "/probe", {
    transports: ["websocket"],
    reconnection: false,
  });

  try {
    const greeting = await new Promise((resolve, reject) => {
      socket.once("ready", resolve);

      socket.once("connect_error", reject);
    });

    expect(greeting).toEqual({ message: "ready" });

    const disconnected = new Promise((resolve) =>
      socket.once("disconnect", resolve),
    );

    await handle.shutdown();

    await disconnected;

    expect(handle.server!.listening).toBe(false);
    expect(socket.connected).toBe(false);
  } finally {
    socket.disconnect();
  }
});

test("inspection skips socket setup and readiness hooks", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      export default () => ({});
      export function onReady() { throw new Error('must not run during inspection'); }
    `,
    "modules/probe/sockets/probe.sockets.js": `export default () => { throw new Error('must not attach sockets'); };`,
  });

  const handle = await app.boot({ inspect: true });

  expect(handle.ctx.sockets).toBeUndefined();
  expect(handle.server!.listening).toBe(false);
});
