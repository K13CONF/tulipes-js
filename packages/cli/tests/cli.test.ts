import { access, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runNewModule } from "../src/new-module.js";
import { runSync } from "../src/sync.js";
import { runInit } from "../src/init.js";
import { fixture } from "../../core/tests/fixture.js";

test("a generated kebab-case module produces valid TypeScript configuration declarations", async () => {
  const app = await fixture({
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
  });

  await runNewModule(app.rootDir, "billing-history");

  await runSync(app.rootDir);

  const path = app.rootDir + "/types/config.d.ts";

  const result = spawnSync(
    resolve("node_modules/.bin/tsc"),
    [path, "--noEmit", "--skipLibCheck"],
    { encoding: "utf8" },
  );

  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(await readFile(path, "utf8")).toContain('"billing-history"?');
});

test("new module emits model and bootstrap files only for apps that declare a models provider", async () => {
  const exists = (path: string) => access(path).then(() => true, () => false);

  const bare = await fixture({ "modules/core/package.json": '{"name":"@test/core","type":"module"}' });
  await runNewModule(bare.rootDir, "notes");
  expect(await exists(bare.rootDir + "/modules/notes/models/notes.model.ts")).toBe(false);
  expect(await exists(bare.rootDir + "/modules/notes/bootstrap/notes.bootstrap.ts")).toBe(false);
  expect(JSON.parse(await readFile(bare.rootDir + "/modules/notes/package.json", "utf8")).dependencies).not.toHaveProperty("mongoose");

  await runNewModule(bare.rootDir, "forced", { models: true });
  expect(await exists(bare.rootDir + "/modules/forced/models/forced.model.ts")).toBe(true);
  await expect(bare.boot({ mode: "script" })).rejects.toThrow(/\[forced\] requires capability "models"/);

  const declared = await fixture({
    "package.json": JSON.stringify({ type: "module", tulipes: { providers: { models: "@tulipes/mongoose" } } }),
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
  });
  await runNewModule(declared.rootDir, "notes");
  expect(await readFile(declared.rootDir + "/modules/notes/models/notes.model.ts", "utf8")).toContain('from "@tulipes/mongoose"');
  expect(JSON.parse(await readFile(declared.rootDir + "/modules/notes/package.json", "utf8")).dependencies).toMatchObject({ "@tulipes/mongoose": expect.any(String), mongoose: "^8" });

  await runNewModule(declared.rootDir, "plain", { models: false });
  expect(await exists(declared.rootDir + "/modules/plain/models")).toBe(false);
});

test.each([false, true])(
  "generated authentication isolates guests before rai, with Passport: %s",
  async (withPassport) => {
    const app = await fixture();

    await runInit(app.rootDir, "generated", "production");

    await app.write(
      "generated/check-auth.ts",
      `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import express from 'express';
    import passport from 'passport';
    import { Strategy, ExtractJwt } from 'passport-jwt';
    import { auth } from './modules/auth/helpers/auth.ts';
    import { authenticate } from './modules/auth/helpers/passport.ts';
    const app = express();
    if (${withPassport}) {
      passport.use(new Strategy({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: 'test-only',
      }, () => { throw new Error('no token should reach verification'); }));
      app.use(authenticate());
    }
    const requestAuth = req => ${withPassport} ? req.auth : auth(req);
    app.get('/change', (req, res) => {
      requestAuth(req).isAuthenticated = true;
      res.json({ authenticated: requestAuth(req).isAuthenticated });
    });
    app.get('/guest', (req, res) => { res.json({ authenticated: requestAuth(req).isAuthenticated }); });
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      const get = async path => (await fetch(base + path, { headers: { connection: 'close' } })).json();
      assert.deepEqual(await get('/change'), { authenticated: true });
      assert.deepEqual(await get('/guest'), { authenticated: false });
    } finally { await new Promise(resolve => server.close(resolve)); }
  `,
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", app.rootDir + "/generated/check-auth.ts"],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
  },
);
