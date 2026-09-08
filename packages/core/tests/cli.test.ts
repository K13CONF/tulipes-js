import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runNewModule } from "../src/cli/new-module.js";
import { runSync } from "../src/cli/sync.js";
import { runInit } from "../src/cli/init.js";
import { fixture } from "./fixture.js";

test("a generated kebab-case module produces valid TypeScript configuration declarations", async () => {
  const app = await fixture({
    "modules/core/package.json": '{"name":"@test/core","type":"module"}',
  });
  await runNewModule(app.rootDir, "billing-history");
  await runSync(app.rootDir);
  const path = app.rootDir + "/types/config.d.ts";
  const result = spawnSync(resolve("node_modules/.bin/tsc"), [path, "--noEmit", "--skipLibCheck"], { encoding: "utf8" });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(await readFile(path, "utf8")).toContain('"billing-history"?');
});

test.each([false, true])("generated authentication isolates guests before rai, with Passport: %s", async (withPassport) => {
  const app = await fixture();
  await runInit(app.rootDir, "generated");
  await app.write("generated/check-auth.ts", `
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
  `);
  const result = spawnSync(process.execPath, ["--import", "tsx", app.rootDir + "/generated/check-auth.ts"], {
    encoding: "utf8", timeout: 5_000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
