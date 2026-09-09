<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="340">

</div>

# @tulipes/spec

Generates an **OpenAPI 3.1 document** and a **Postman collection** from a
[Tulipes](https://www.npmjs.com/package/@tulipes/core) app's declared
routes.

Requires Node 24.x. Inspection connects infrastructure declared by the app:
the minimal starter needs no services; the production starter needs MongoDB
and Redis. There is no general offline mode yet.

Version 0.3.0-rc.2 supports core `^0.8.0 || ^0.9.0-rc.1`. Install the candidate
with `yarn add -D @tulipes/spec@next`. See the core
[migration guide](https://github.com/kemora13conf/bp-backend-express/blob/v0.8.0/packages/core/MIGRATING.md#reliability-contracts-08)
when upgrading from an earlier release.

The source is the RAI registry of a *booted* app — not parsed source — so a
generated document describes exactly the router that is mounted. It cannot
invent an endpoint, and it cannot miss one.

```sh
yarn add -D @tulipes/spec@next
yarn tulipes spec --openapi docs/openapi.json --postman docs/collection.json
```

```
  wrote docs/openapi.json
  wrote docs/collection.json

21 endpoint(s) across 4 folder(s): auth, hello, sessions, users
```

## Where the content comes from

Everything except the request shapes is already declared:

| In the document | Comes from |
|---|---|
| path, method | the mounted express route |
| `operationId`, summary, description | the route's `rai({ id, name, description })` |
| tag / folder | `rai({ folder })`, defaulting to the declaring module |
| security, `x-tulipes-roles` | the ACL — which roles hold that permission |
| response envelope | the framework's one response shape |
| success status | `rai({ status })`, defaulting to 200; 204 has no JSON body |
| request/response schemas | `rai({ params, query, body, returns })` |

Schemas are zod, declared on the route and **validated at runtime by the
framework** — which is the point. A document generated from the same
declaration that enforces the request cannot describe a shape the endpoint
would reject.

```ts
import { z } from "zod/v4";

router.post(
  `${base}/users`,
  rai({
    id: "users:create",
    name: "Create a user",
    body: z.object({ email: z.email("emailInvalid") }),
    returns: z.object({ id: z.string(), email: z.string() }),
  }),
  users.create(),
);
```

**Use `zod/v4`.** `z.toJSONSchema` is what this package calls and it only
understands v4 schemas. A classic `from "zod"` schema still validates, but
produces no shape in the document — `tulipes spec` reports each one it
could not describe rather than failing silently.

## Why a Postman collection and not just the OpenAPI

Postman imports OpenAPI perfectly well. A native collection carries what
that import cannot:

- **one folder per `folder`**, mirroring how the app is organised
- `{{baseUrl}}`, `{{accessToken}}` and `{{refreshToken}}` variables, with
  bearer auth inherited by every request
- `noauth` on public routes, so a public endpoint is genuinely exercised
  as the public would reach it
- a script on the login request that **captures the token pair** — sign in
  once and the rest of the collection is authenticated
- example bodies built from the schemas, so a request is runnable as
  imported rather than an empty `{}`

## Programmatic use

The CLI is a thin wrapper; the pieces are exported:

```ts
import { extract, toOpenApi, toPostman } from "@tulipes/spec";
import { boot } from "@tulipes/core/boot";

const handle = await boot({ rootDir, mode: "backend", inspect: true, handleSignals: false });
try {
  const source = extract(handle.ctx);
  const { document, warnings } = await toOpenApi(source, {
    servers: ["https://api.example.com"],
  });
  // Write the document and report warnings here.
} finally {
  await handle.shutdown();
}
```

Inspection skips bootstrap, sockets, listening and readiness hooks, so it can run
while the app is serving. Imports, config/route factories and applicable database
and queue connections still run. Always release them with `shutdown()`.

Custom access checkers produce dynamic authorization metadata and warnings;
the generator cannot infer their roles or credentials. Configure authorization
manually for these Postman requests; they do not inherit the collection's bearer
token. OpenAPI omits a static security requirement for these operations.

## Options

| Flag | Meaning |
|---|---|
| `--openapi <file>` | write an OpenAPI 3.1 document |
| `--postman <file>` | write a Postman v2.1 collection |
| `--url <base>` | base URL both documents advertise; defaults to the app's own `PORT` / `PUBLIC_DOMAIN` |

Name at least one output. Commit what it writes: a generated document is
an artifact a reviewer can diff, and an unexpected change in it usually
means an unexpected change to the API.

## Requirements

`@tulipes/core` ≥ 0.6 · zod ≥ 3.25 (for the `zod/v4` subpath) — both peer
dependencies, so this package never pins a second copy of either.

---

<div align="center">
<sub>Part of <a href="https://www.npmjs.com/package/@tulipes/core">Tulipes</a></sub>
</div>
