import express from "express";
import { describe, expect, test } from "vitest";
import { createRai, RouteRegistry } from "../src/http/rai.ts";
import { scanRoutes } from "../src/http/route-scan.ts";
import { BootReport } from "../src/errors/boot-error.ts";

const respond: express.RequestHandler = (_req, res) => {
  res.json({ reached: true });
};

describe("route declaration enforcement", () => {
  test("rejects an endpoint that can respond before authorization", () => {
    const app = express();
    const rai = createRai(new RouteRegistry(), () => false);

    app.get("/secret", respond, rai({ id: "secret:web:read" }));

    const report = new BootReport();

    scanRoutes(app, report);

    expect(() => report.throwIfAny("routes")).toThrow(/first.*rai|rai.*first/);
  });
});

test("rejects a POST without authorization even when the same route guards GET", () => {
  const app = express();
  const rai = createRai(new RouteRegistry(), () => false);

  app
    .route("/secret")
    .get(rai({ id: "secret:web:read" }), respond)
    .post(respond);

  const report = new BootReport();

  scanRoutes(app, report);

  expect(() => report.throwIfAny("routes")).toThrow(/POST.*rai/);
});

test("records each explicitly guarded method separately", () => {
  const app = express();
  const rai = createRai(new RouteRegistry(), () => true);

  app
    .route("/items")
    .get(rai({ id: "items:web:read" }), respond)
    .post(rai({ id: "items:web:create" }), respond);

  const report = new BootReport();

  expect(
    scanRoutes(app, report).map(({ method, info }) => [method, info.id]),
  ).toEqual([
    ["GET", "items:web:read"],
    ["POST", "items:web:create"],
  ]);

  expect(report.issues).toEqual([]);
});

test("rejects route.all instead of emitting an invalid OpenAPI method", () => {
  const app = express();
  const rai = createRai(new RouteRegistry(), () => true);

  app.route("/items").all(rai({ id: "items:web:all" }), respond);

  const report = new BootReport();

  scanRoutes(app, report);

  expect(() => report.throwIfAny("routes")).toThrow(/all.*unsupported/);
});

test("preserves explicit nested mount paths", () => {
  const app = express(),
    parent = express.Router(),
    child = express.Router();

  const registry = new RouteRegistry(),
    rai = createRai(registry, () => true);

  child.get("/items/:id", rai({ id: "items:web:read" }), respond);

  registry.mount(parent, "/catalog", child);

  registry.mount(app, "/api", parent);

  const report = new BootReport();

  expect(scanRoutes(app, report).map(({ path }) => path)).toEqual([
    "/api/catalog/items/:id",
  ]);

  expect(report.issues).toEqual([]);
});

test.each([
  { path: "/files/*path" },
  { path: ["/a", "/b"] },
  { path: /\/items/ },
])(
  "rejects unsupported path patterns rather than misreporting URLs: $path",
  ({ path }) => {
    const app = express(),
      rai = createRai(new RouteRegistry(), () => true);

    app.get(path, rai({ id: "items:web:read" }), respond);

    const report = new BootReport();

    scanRoutes(app, report);

    expect(() => report.throwIfAny("routes")).toThrow(
      /unsupported.*path|path.*unsupported/,
    );
  },
);

test("rejects duplicate declarations and unknown router mount paths", () => {
  const app = express(),
    child = express.Router();

  const rai = createRai(new RouteRegistry(), () => true);

  app.get("/a", rai({ id: "items:web:read" }), respond);

  app.get("/b", rai({ id: "items:web:read" }), respond);

  child.get("/c", rai({ id: "items:web:other" }), respond);

  app.use("/unknown", child);

  const report = new BootReport();

  scanRoutes(app, report);

  expect(report.issues.map((issue) => issue.message).join("\n")).toMatch(
    /already declared/,
  );

  expect(report.issues.map((issue) => issue.message).join("\n")).toMatch(
    /mount path is unknown/,
  );
});

test("rejects an invalid declared success status", () => {
  const app = express(),
    rai = createRai(new RouteRegistry(), () => true);

  app.get("/a", rai({ id: "items:web:read", status: 700 }), respond);

  const report = new BootReport();

  scanRoutes(app, report);

  expect(() => report.throwIfAny("routes")).toThrow(/status.*2xx/);
});

test("mounts prefixes with dots and named parameters while rejecting wildcards", () => {
  const app = express(),
    router = express.Router(),
    registry = new RouteRegistry();

  const rai = createRai(registry, () => true);

  router.get("/keys", rai({ id: "keys:web:read" }), respond);

  registry.mount(app, "/.well-known", router);

  expect(scanRoutes(app, new BootReport())[0]?.path).toBe("/.well-known/keys");
  expect(() => registry.mount(app, "/:tenant", router)).not.toThrow();
  expect(() => registry.mount(app, "/*tenant", router)).toThrow(/literal path/);
});

test("rejects recursive router mounts instead of looping during inspection", () => {
  const app = express(),
    router = express.Router(),
    registry = new RouteRegistry();

  registry.mount(router, "/loop", router);

  registry.mount(app, "/api", router);

  const report = new BootReport();

  scanRoutes(app, report);

  expect(() => report.throwIfAny("routes")).toThrow(/recursive router/);
});

test.each([
  { first: "/items", second: "/items" },
  { first: "/items/:id", second: "/items/:name" },
])(
  "rejects ambiguous endpoint URLs $first and $second even with distinct IDs",
  ({ first, second }) => {
    const app = express(),
      router = express.Router(),
      registry = new RouteRegistry();

    const rai = createRai(registry, () => true);

    app.get("/api" + first, rai({ id: "items:web:first" }), respond);

    router.get(second, rai({ id: "items:web:second" }), respond);

    registry.mount(app, "/api", router);

    const report = new BootReport();

    scanRoutes(app, report);

    expect(() => report.throwIfAny("routes")).toThrow(
      /GET.*already declared.*items:web:first/,
    );
  },
);
