import mongoose from "mongoose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fixture } from "./fixture.js";

const mongo = process.env.TEST_MONGO_URI;
const integration = test.skipIf(!mongo);
const declared = JSON.stringify({ type: "module", tulipes: { providers: { models: "@tulipes/core/db" } } });

beforeEach(() => {
  if (mongo) vi.stubEnv("MONGO_URI", mongo);
});

afterEach(async () => {
  // Also release connections if a regression causes boot to leak one.
  await Promise.all(
    mongoose.connections
      .filter((c) => c.readyState !== 0)
      .map((c) => c.close()),
  );
});

integration(
  "releases the acquired connection when model registration fails",
  async () => {
    const app = await fixture({
      "package.json": declared,
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: [
          {
            name: "MONGO_URI",
            type: "url",
            default: mongo,
            description: "Test database",
          },
        ],
      }),
      "modules/probe/models/broken.model.js": `export default { name: 'Broken' };`,
    });

    await expect(app.boot({ mode: "script" })).rejects.toThrow(/ModelDef/);

    expect(mongoose.connections.filter((c) => c.readyState !== 0)).toHaveLength(
      0,
    );
  },
);

integration(
  "releases Mongo even when schema compilation throws outside the boot report",
  async () => {
    const app = await fixture({
      "package.json": declared,
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: [
          {
            name: "MONGO_URI",
            type: "url",
            default: mongo,
            description: "Test database",
          },
        ],
      }),
      "modules/probe/models/broken.model.js": `
      import { Schema } from 'mongoose';
      const schema = new Schema({});
      schema.on('init', () => { throw new Error('compile failed'); });
      export default { name: 'Broken', schema };
    `,
    });

    await expect(app.boot({ mode: "script" })).rejects.toThrow(
      /compile failed/,
    );

    expect(mongoose.connections.filter((c) => c.readyState !== 0)).toHaveLength(
      0,
    );
  },
);

integration(
  "inspection mounts routes without running bootstrap tasks",
  async () => {
    const { access } = await import("node:fs/promises");

    const app = await fixture({
      "package.json": declared,
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: [
          {
            name: "MONGO_URI",
            type: "url",
            default: mongo,
            description: "Test database",
          },
        ],
      }),
    });

    await app.write(
      "modules/probe/bootstrap/probe.bootstrap.js",
      `
    import { writeFileSync } from 'node:fs';
    export default () => writeFileSync(${JSON.stringify(app.rootDir + "/seeded")}, 'seeded');
  `,
    );

    const handle = await app.boot({ inspect: true });

    expect(handle.app).toBeDefined();
    expect(handle.server?.listening).toBe(false);

    await expect(access(app.rootDir + "/seeded")).rejects.toThrow();
  },
);

integration(
  "shutdown bounds forced database cleanup when the driver does not settle",
  async () => {
    const app = await fixture({
      "package.json": declared,
      "modules/probe/meta.variables.json": JSON.stringify({
        variables: [
          {
            name: "MONGO_URI",
            type: "url",
            default: mongo,
            description: "Test database",
          },
        ],
      }),
    });

    const handle = await app.boot({ mode: "script", shutdownTimeoutMs: 50 });
    const connection = handle.ctx.models!.connection;

    const close = vi
      .spyOn(connection, "close")
      .mockRejectedValue(new Error("driver close failed"));

    let releaseForce: () => void = () => {};

    const destroy = vi.spyOn(connection, "destroy").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseForce = resolve;
        }),
    );

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const stopping = handle.shutdown();

      const outcome = Promise.race([
        stopping,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("shutdown still pending"), 500);
        }),
      ]);

      await expect(outcome).rejects.toThrow(
        /provider mongoose forced cleanup.*timed out/,
      );
    } finally {
      clearTimeout(timer);

      releaseForce();

      close.mockRestore();

      destroy.mockRestore();

      await connection.destroy(true);
    }
  },
);
