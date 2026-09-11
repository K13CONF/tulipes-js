import { expect, test } from "vitest";
import { extract } from "../src/extract.js";
import { fixture } from "../../core/tests/fixture.js";

test("extracts mounted paths, statuses and custom authorization from the inspected app", async () => {
  const app = await fixture({
    "modules/probe/routes/probe.routes.js": `
      import { Router } from 'express';
      export default ctx => {
        const child = Router();
        child.post('/items', ctx.rai({ id: 'probe:create', status: 201 }), (req, res) => res.respond({ data: {} }));
        ctx.routes.mount(ctx.app, '/catalog', child);
        ctx.routes.setAccessChecker(() => true);
      };
    `,
  });

  const handle = await app.boot({ inspect: true });

  expect(extract(handle.ctx).routes).toEqual([
    expect.objectContaining({
      path: "/catalog/items",
      method: "POST",
      status: 201,
      authorization: "dynamic",
      roles: [],
      public: false,
    }),
  ]);
});
