---
name: tulipes-spec
description: Use when validating request input in a Tulipes app, adding a zod schema to a route, generating OpenAPI or a Postman collection, or grouping endpoints in the generated documents. Covers rai() schemas, the folder property and `tulipes spec`.
---

# Schemas, validation and generated specs

A route's schemas are declared once, in its `rai()` call, and used twice: the
framework validates the request against them, and `tulipes spec` describes
them. That is the whole point — documentation cannot claim a shape the
endpoint would reject.

```ts
import { z } from "zod/v4";           // v4, not the classic import

router.post("/users", rai({
  id: "users:bo:create",
  name: "Create a user",
  body: z.object({ email: z.email("emailInvalid") }),
  returns: z.object({ id: z.string(), email: z.string() }),
}), users.create());

```

`params`, `query` and `body` are validated. `returns` never is — a handler
is trusted with its own output — it exists so the document can describe the
response.

**Use `zod/v4`.** `z.toJSONSchema` is what the generator calls, and it only
understands v4 schemas. The classic `from "zod"` import still validates but
produces no shape in the document, and `tulipes spec` will say so.

Keep schemas in `modules/<name>/schemas/<name>.schemas.ts` when a route file
starts to sprawl; the example's users, auth and config modules do.

## What validation gives you

Failures become the envelope's `errors[]`, with no handler code:

```jsonc
{ "success": false, "data": null,
  "errors": [{ "field": "email", "message": "Must be a valid email address",
               "code": "INVALID_FORMAT" }],
  "meta": {} }
```

- **The zod message doubles as an i18n key.** `z.email("emailInvalid")`
  resolves in this module's namespace, so a rejected field speaks the
  caller's language. A plain sentence passes through unchanged.
- `code` comes from zod's issue code, uppercased — `INVALID_FORMAT`,
  `TOO_SMALL`. Clients branch on it; it is never translated.
- All three segments are checked before answering, so a request wrong in
  the query *and* the body says so once.
- Coerced values are written back: `z.coerce.number()` means `req.query.page`
  is a number by the time the handler reads it.
- **Validation runs after the access check.** A caller who may not reach a
  route never learns which of its fields are wrong.

## Grouping: `folder`

`folder` decides the Postman folder and the OpenAPI tag. It defaults to the
declaring module, so grouping is right without saying anything — set it to
split one module's routes apart, or to gather several modules under one
heading:

```ts
rai({ id: "auth:web:sessions", name: "List sessions", folder: "sessions" })
```

## Generating

```sh
pnpm spec     # tulipes spec --openapi docs/openapi.json --postman docs/collection.json
```

One document per client surface: the RAI's scope is a filter, so a mobile
team gets only what the mobile app calls. Every operation carries
`x-tulipes-scope`, and the document lists the app's roles (with their
descriptions and extras) under `x-tulipes-roles`.

```sh
pnpm tulipes spec --openapi docs/mobile.json --scope mobile
pnpm tulipes spec --postman docs/backoffice.json --scope bo
```

Generation is an inspection boot: every routes file runs with nothing
acquired, so no service, secret or `.env` is needed, and a routes file that
touches infrastructure while building fails with its path. `--url` sets the
advertised base URL (default `http://localhost:3000`). A custom access
checker installed with `routes.setAccessChecker` is reported as dynamic: the
document makes no static role or public-access claim for it.

The generator lives in `@tulipes/spec`, a dev dependency. Core does not
depend on it, so an app that never generates a spec never installs it.

The Postman collection carries what an OpenAPI import cannot: one folder
per `folder`, `{{baseUrl}}` and `{{accessToken}}` variables, `noauth` on
public routes, and a script on the login request that captures the token
pair — sign in once and the rest of the collection is authenticated.

## Rules

- **Commit the generated documents.** They are artifacts a reviewer can
  diff; a spec that only exists on someone's laptop is not documentation.
- Regenerate after changing any route, and check the diff — an unexpected
  change there usually means an unexpected change to the API.
- A schema is not a substitute for authorization. `rai({ id })` gates the
  route; the schema only shapes the input.
- Never hand-edit the generated files.
