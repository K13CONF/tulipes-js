import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { fixture } from "./fixture.ts";

const log = (line: string) => `appendFileSync(new URL('../../../log.txt', import.meta.url), ${line} + '\\n')`;
const readLog = async (rootDir: string) =>
  (await readFile(rootDir + "/log.txt", "utf8").catch(() => "")).split("\n").filter(Boolean);

test("bootstrap runs in every mode, in load order, after settings and ACL and before routes", async () => {
  const app = await fixture({
    "modules/probe/module.config.js": `
      import { defineConfig } from '@tulipes/core/config';
      import { z } from 'zod/v4';
      export default defineConfig({ schema: z.object({ greeting: z.string().default('hello') }) });
    `,
    "modules/probe/module.acl.js": `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:read');`,
    "modules/probe/bootstrap/probe.bootstrap.js": `
      import { appendFileSync } from 'node:fs';
      export default (ctx) => { ${log("'probe mode=' + ctx.mode + ' greeting=' + ctx.config.probe.greeting + ' acl=' + ctx.acl.can('guest', 'probe:web:read') + ' app=' + (ctx.app === undefined)")}; };
    `,
    "modules/second/package.json": '{"name":"@test/second","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/second/bootstrap/second.bootstrap.js": `
      import { appendFileSync } from 'node:fs';
      export default () => { ${log("'second'")}; };
    `,
    "modules/second/routes/second.routes.js": `
      import { appendFileSync } from 'node:fs';
      export default () => { ${log("'routes'")}; };
    `,
  });

  for (const mode of ["script", "backend"] as const) {
    const handle = await app.boot({ mode, listen: false });
    await handle.shutdown();
  }

  expect(await readLog(app.rootDir)).toEqual([
    "probe mode=script greeting=hello acl=true app=true",
    "second",
    "probe mode=backend greeting=hello acl=true app=true",
    "second",
    "routes",
  ]);
});

test("cleanups run in reverse load order after providers drain and before they dispose", async () => {
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": `
      import { appendFileSync } from 'node:fs';
      export default () => () => ${log("'probe cleanup'")};
    `,
    "modules/second/package.json": '{"name":"@test/second","type":"module","tulipes":{"dependsOn":["probe"]}}',
    "modules/second/bootstrap/second.bootstrap.js": `
      import { appendFileSync } from 'node:fs';
      export default () => async () => ${log("'second cleanup'")};
    `,
  });

  const handle = await app.boot({ mode: "script" });
  await handle.shutdown();

  expect(await readLog(app.rootDir)).toEqual(["second cleanup", "probe cleanup"]);
});

test("inspection runs no bootstrap at all", async () => {
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": `export default () => { throw new Error('must not run during inspection'); };`,
  });

  const handle = await app.boot({ inspect: true });
  await handle.shutdown();
});

test("a bootstrap that is not a function, returns the wrong thing or throws is reported with its file", async () => {
  const notFunction = await fixture({ "modules/probe/bootstrap/probe.bootstrap.js": `export default 42;` });
  await expect(notFunction.boot({ mode: "script" })).rejects.toThrow(/probe\.bootstrap\.js must default-export a bootstrap function/);

  const wrongReturn = await fixture({ "modules/probe/bootstrap/probe.bootstrap.js": `export default () => 'done';` });
  await expect(wrongReturn.boot({ mode: "script" })).rejects.toThrow(/returned string; a bootstrap returns nothing or its cleanup function/);

  const throws = await fixture({ "modules/probe/bootstrap/probe.bootstrap.js": `export default () => { throw new Error('seed exploded'); };` });
  await expect(throws.boot({ mode: "script" })).rejects.toThrow(/Boot aborted during "bootstrap"[\s\S]*seed exploded/);
});

test("a bootstrap directory no longer implies a models provider", async () => {
  const app = await fixture({
    "modules/probe/bootstrap/probe.bootstrap.js": `export default (ctx) => { if (ctx.models !== undefined) throw new Error('no provider was declared'); };`,
  });

  const handle = await app.boot({ mode: "script" });
  await handle.shutdown();
});
