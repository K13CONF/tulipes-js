import express from "express";
import { expect, test } from "vitest";
import { ANONYMOUS, createRai, RouteRegistry } from "../src/http/rai.js";
import { bindRespond } from "../src/http/respond.js";

async function request(app: express.Express, path: string) {
  const server = app.listen(0, "127.0.0.1");

  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();

  if (!address || typeof address === "string") throw new Error("no TCP port");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: { connection: "close" },
    });

    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("res.respond uses the route's declared success status", async () => {
  const app = express();

  const rai = createRai(
    new RouteRegistry(),
    () => true,
    (req, res) => bindRespond(req, res, {}),
  );

  app.get("/created", rai({ id: "items:create", status: 201 }), (_req, res) => {
    res.respond({ data: { id: 1 } });
  });

  expect(await request(app, "/created")).toEqual({
    status: 201,
    body: { success: true, data: { id: 1 }, errors: [], meta: {} },
  });
});

test("validates and coerces input before the handler and aggregates invalid segments", async () => {
  const { z } = await import("zod");
  const { errorHandler } = await import("../src/http/error-handler.js");
  const app = express();

  const rai = createRai(
    new RouteRegistry(),
    () => true,
    (req, res) => bindRespond(req, res, {}),
  );

  app.get(
    "/items/:id",
    rai({
      id: "items:read",
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({ count: z.coerce.number().int().positive() }),
    }),
    (req, res) => {
      res.respond({ data: { id: req.params.id, count: req.query.count } });
    },
  );

  app.use(errorHandler("production"));

  expect(await request(app, "/items/12?count=3")).toMatchObject({
    status: 200,
    body: { data: { id: 12, count: 3 } },
  });

  const rejected = await request(app, "/items/wrong?count=wrong");

  expect(rejected).toMatchObject({
    status: 422,
    body: {
      success: false,
      data: null,
      meta: {},
      errors: [
        { field: "id", code: "INVALID_TYPE" },
        { field: "count", code: "INVALID_TYPE" },
      ],
    },
  });
});

test.each([
  { role: "guest", authenticated: false, status: 401 },
  { role: "user", authenticated: true, status: 403 },
  { role: "unknown", authenticated: true, status: 403 },
  { role: "admin", authenticated: true, status: 200 },
])(
  "access enforcement for $role produces $status",
  async ({ role, authenticated, status }) => {
    const { Acl } = await import("../src/acl/acl.js");
    const { BootReport } = await import("../src/errors/boot-error.js");
    const { errorHandler } = await import("../src/http/error-handler.js");
    const acl = new Acl();

    acl
      .forModule("auth", new BootReport())
      .defineRole("guest")
      .defineRole("user")
      .defineRole("admin")
      .allow("admin", "items:read");

    const app = express();

    app.use((req, _res, next) => {
      req.auth = {
        isAuthenticated: authenticated,
        user: { role },
        session: null,
      };

      next();
    });

    const rai = createRai(
      new RouteRegistry(),
      (role, id) => acl.can(role, id),
      (req, res) => bindRespond(req, res, {}),
    );

    app.get("/items", rai({ id: "items:read" }), (_req, res) => {
      res.respond({ data: [] });
    });

    app.use(errorHandler("production"));

    expect((await request(app, "/items")).status).toBe(status);
  },
);

test.each(["/items", "/items?required=present"])(
  "waits for asynchronous access denial before validating or responding to %s",
  async (path) => {
    const { z } = await import("zod");
    const { errorHandler } = await import("../src/http/error-handler.js");

    const app = express(),
      registry = new RouteRegistry();

    registry.setAccessChecker(async () => false);

    const rai = createRai(
      registry,
      () => true,
      (req, res) => bindRespond(req, res, {}),
    );

    app.get(
      "/items",
      rai({ id: "items:read", query: z.object({ required: z.string() }) }),
      (_req, res) => {
        res.respond({ data: "private" });
      },
    );

    app.use(errorHandler("production"));

    expect(await request(app, path)).toMatchObject({
      status: 401,
      body: {
        success: false,
        data: null,
        errors: [{ code: "UNAUTHENTICATED" }],
      },
    });
  },
);

test.each([
  { decision: "allow", status: 200 },
  { decision: "error", status: 500 },
])(
  "handles an asynchronous access check that returns $decision",
  async ({ decision, status }) => {
    const { errorHandler } = await import("../src/http/error-handler.js");

    const app = express(),
      registry = new RouteRegistry();

    registry.setAccessChecker(async () => {
      if (decision === "error") throw new Error("policy unavailable");

      return true;
    });

    const rai = createRai(
      registry,
      () => false,
      (req, res) => bindRespond(req, res, {}),
    );

    app.get("/items", rai({ id: "items:read" }), (_req, res) => {
      res.respond({ data: "private" });
    });

    app.use(errorHandler("production"));

    expect(await request(app, "/items")).toMatchObject({
      status,
      body: { data: decision === "allow" ? "private" : null },
    });
  },
);

test.each([false, true])(
  "isolates anonymous authentication with a middleware guest fallback: %s",
  async (middleware) => {
    const { errorHandler } = await import("../src/http/error-handler.js");
    const app = express();

    if (middleware)
      app.use((req, _res, next) => {
        req.auth = ANONYMOUS;

        next();
      });

    const rai = createRai(
      new RouteRegistry(),
      (role, id) => id === "auth:login" || role === "admin",
      (req, res) => bindRespond(req, res, {}),
    );

    let restoreAuth = () => {};

    app.get("/login", rai({ id: "auth:login" }), (req, res) => {
      const original = { ...req.auth };

      restoreAuth = () => {
        Object.assign(req.auth, original);
      };

      req.auth.isAuthenticated = true;

      req.auth.user = { role: "admin" };

      res.respond({ data: "signed in" });
    });

    app.get("/private", rai({ id: "items:read" }), (_req, res) => {
      res.respond({ data: "private" });
    });

    app.use(errorHandler("production"));

    try {
      expect((await request(app, "/login")).status).toBe(200);

      expect(await request(app, "/private")).toMatchObject({
        status: 401,
        body: { success: false, data: null },
      });
    } finally {
      restoreAuth();
    }
  },
);

test.each(["false", 1, {}])(
  "denies a custom checker result that is not a boolean: %j",
  async (decision) => {
    const { errorHandler } = await import("../src/http/error-handler.js");

    const app = express(),
      registry = new RouteRegistry();

    // JavaScript modules can return invalid decisions despite the TypeScript contract.
    // @ts-expect-error Only boolean decisions are permitted.
    registry.setAccessChecker(async () => decision);

    const rai = createRai(
      registry,
      () => false,
      (req, res) => bindRespond(req, res, {}),
    );

    app.get("/items", rai({ id: "items:read" }), (_req, res) => {
      res.respond({ data: "private" });
    });

    app.use(errorHandler("production"));

    expect(await request(app, "/items")).toMatchObject({
      status: 401,
      body: { data: null },
    });
  },
);
