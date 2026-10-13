import { expect, test } from "vitest";
import { fixture } from "../../core/tests/fixture.ts";
import { bootTestApp, useTestApp } from "../src/index.ts";

/**
 * The package against a fixture app with a public route, a guarded one, a
 * settings namespace and a stand-in auth module shaped like the production
 * preset's register and login endpoints.
 */
const files = {
  "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').defineRole('user').allow('guest', 'probe:web:read', 'auth:web:register', 'auth:web:login').allow('user', 'probe:web:write');`,
  "modules/probe/module.config.js": `
    import { defineConfig } from '@tulipes/core/config';
    import { z } from 'zod/v4';
    export default defineConfig({ schema: z.object({ greeting: z.string().default('Hello') }) });
  `,
  "modules/probe/routes/probe.routes.js": `
    import express, { Router } from 'express';
    export default ctx => {
      const r = Router();
      r.use(express.json());
      r.use((req, res, next) => {
        const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        if (token?.startsWith('user:')) req.auth = { isAuthenticated: true, user: { _id: token.slice(5), role: 'user' }, session: null };
        next();
      });
      r.get('/things', ctx.rai({ id: 'probe:web:read' }), (req, res) => res.respond({ data: { greeting: ctx.config.probe.greeting, q: req.query.q ?? null, mark: process.env.PROBE_MARK } }));
      r.post('/things', ctx.rai({ id: 'probe:web:write' }), (req, res) => res.respond({ status: 201, data: { echoed: req.body, by: req.auth.user._id } }));
      r.post('/auth/register', ctx.rai({ id: 'auth:web:register' }), (req, res) => res.respond({ status: 201, data: { user: { id: 'u-' + req.body.email.length }, access_token: 'user:u-' + req.body.email.length, refresh_token: 'r' } }));
      r.post('/auth/login', ctx.rai({ id: 'auth:web:login' }), (req, res) => res.respond({ data: { user: { id: 'u' }, access_token: 'user:u', refresh_token: 'r2' } }));
      return r;
    };
  `,
};

test("boots on a free port with the env and settings asked for, decodes the envelope, and restores the environment", async () => {
  const fixtureApp = await fixture(files);
  const before = process.env.PROBE_MARK;
  const app = await bootTestApp({ rootDir: fixtureApp.rootDir, env: { PROBE_MARK: "set" }, settings: { probe: { greeting: "Howdy" } } });
  try {
    expect(app.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(app.prefix).toBe("");
    expect(process.env.PROBE_MARK).toBe("set");

    const ok = await app.get<{ greeting: string; q: string | null; mark: string }>("/things", { query: { q: "x" } });
    expect(ok.status).toBe(200);
    // The variable asked for reached the booted process; the port was free.
    expect(ok.data).toEqual({ greeting: "Howdy", q: "x", mark: "set" });
    expect(ok.body).toMatchObject({ success: true, errors: [] });

    const denied = await app.post("/things", { a: 1 });
    expect(denied.status).toBe(401);
    expect(denied.errors[0]).toMatchObject({ code: "UNAUTHENTICATED" });

    const missing = await app.get("/nowhere");
    expect(missing.status).toBe(404);
    expect(missing.data).toBeNull();

    const user = await app.as("user");
    expect(user).toMatchObject({ userId: expect.stringMatching(/^u-/), access_token: expect.stringMatching(/^user:/) });
    const created = await app.post<{ echoed: unknown; by: string }>("/things", { a: 1 }, { as: user });
    expect(created.status).toBe(201);
    expect(created.data).toEqual({ echoed: { a: 1 }, by: user.userId });
    expect((await app.post("/things", { a: 1 }, { token: user.access_token })).status).toBe(201);

    await expect(app.as("admin")).rejects.toThrow(/needs the app's models to promote/);
    expect(await app.login("a@b.c", "pw")).toMatchObject({ userId: "u", access_token: "user:u" });
  } finally {
    await app.shutdown();
  }
  expect(process.env.PROBE_MARK).toBe(before);
});

test("useTestApp delegates to the app booted by the hooks and refuses use before that", async () => {
  const fixtureApp = await fixture(files);
  const hooks: { before?: () => Promise<void>; after?: () => Promise<void>; timeout?: number } = {};
  const hooked = useTestApp({ rootDir: fixtureApp.rootDir }, {
    beforeAll(fn, timeout) { hooks.before = fn; hooks.timeout = timeout; },
    afterAll(fn) { hooks.after = fn; },
  });
  expect(hooks.timeout).toBe(30_000);
  expect(() => hooked.base).toThrow(/not booted yet/);

  await hooks.before!();
  try {
    expect(hooked.base).toMatch(/^http:\/\//);
    expect((await hooked.get("/things")).status).toBe(200);
    expect(hooked.ctx.config.probe).toEqual({ greeting: "Hello" });
  } finally {
    await hooks.after!();
  }
  expect(() => hooked.base).toThrow(/not booted yet/);
});
