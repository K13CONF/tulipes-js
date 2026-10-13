<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="340">

</div>

# @tulipes/testing

Test an app written with [Tulipes](https://www.npmjs.com/package/@tulipes/core):
boot it once per test file on a random port, call its endpoints with the
envelope decoded, sign in as a role. Runner-agnostic — it takes the file
hooks it needs — and dependency-free beyond `@tulipes/core`.

```ts
// modules/hello/tests/hello.test.ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { useTestApp } from "@tulipes/testing";

const app = useTestApp({ rootDir: new URL("../../..", import.meta.url).pathname }, { beforeAll, afterAll });

test("greets", async () => {
  const { status, data } = await app.get<{ message: string }>(app.api("/hello"));
  expect(status).toBe(200);
  expect(data?.message).toMatch(/^Hello/);
});

test("the secret needs a role", async () => {
  expect((await app.get(app.api("/hello/secret"))).status).toBe(401);
  const user = await app.as("user");
  expect((await app.get(app.api("/hello/secret"), { as: user })).status).toBe(200);
});
```

## What you get

- `useTestApp(options, { beforeAll, afterAll })` boots in `beforeAll`
  (a free port through `boot({ port: 0 })`, `appEnv: "test"`, no signal
  handlers) and shuts down in
  `afterAll`; `bootTestApp(options)` is the same without the hooks.
- `app.request(method, path, { body, as, token, headers, query })` and the
  `get` / `post` / `patch` / `delete` shorthands return `{ status, headers,
  body, data, errors, raw }` with the envelope decoded and typed by the
  generic; `app.api("/x")` prefixes the configured API prefix.
- `app.register()`, `app.login(email, password)` and `app.as(role)` use the
  auth module the production preset ships (`/auth/register`, `/auth/login`);
  `as` promotes the account through the app's `User` model and signs in
  again, so the tokens resolve to the role.
- `options.settings` writes settings through `ctx.settings.set()` right
  after the boot — proxy trust, CORS, rate limits — the way an operator
  does, so every replica a test boots reads the same values.
- `app.handle` and `app.ctx` for everything else: models, the settings
  manager, a second boot of the same app.

Boot once per file, not per test: a boot connects to the services the app
declares. Keep `fileParallelism: false` in the app's `vitest.config.ts`
while test files share one database.
