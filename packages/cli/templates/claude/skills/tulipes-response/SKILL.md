---
name: tulipes-response
description: Use when writing any endpoint response in a Tulipes app — returning data, paginating a list, reporting a validation failure, or setting meta.action. Covers res.respond, the response envelope, error codes and req.page.
---

# Responding

Every endpoint answers with one shape, so a client writes its unwrapping
once:

```jsonc
{
  "success": true,
  "data": { },      // or [ ], or null on failure
  "errors": [ ],    // [{ field, message, code }] on failure
  "meta": { }       // action, pagination
}
```

`res.respond` builds it. Express is untouched — `res.json`, `res.send` and
`res.status` behave exactly as they always did — so `respond` is a method
you call, never a wrapper you fight.

## Success

```ts
res.respond({ data: user });                        // 200
res.respond({ data: user, status: 201 });           // created
res.respond({ data: null, meta: { action: "complete_profile" } });
```

## Lists and pagination

`req.page` is already parsed from `?page` and `?per_page` and clamped by
`config.pagination`, so no endpoint re-derives it and none can be talked
into ten thousand rows:

```ts
const { per_page, skip } = req.page;
const [items, total_items] = await Promise.all([
  Model.find().skip(skip).limit(per_page).lean(),
  Model.countDocuments(),
]);
res.respond({ data: items, meta: { total_items } });
```

**Passing `total_items` is what marks a response as a page.** `respond`
fills in `page`, `per_page` and `total_pages` from the request and the
count. Without it, `meta` stays clean — a single record does not carry
four null pagination keys.

When clients should search, filter, sort or group the list, don't extend
this by hand: declare a `listQuery(policy)` → skill `tulipes-list-query`.

## Failures are thrown, never responded

The terminal handler builds the same envelope from a thrown error, so a
handler only ever writes the happy path.

```ts
throw new HttpError(404, "notFound");
throw new HttpError(422, "emailTaken", { field: "email" });
```

The message is an **i18n key**. The handler translates it in the module's
namespace — the one the route's RAI recorded — and derives the code from
the key, so `notFound` becomes `NOT_FOUND` and `emailTaken` becomes
`EMAIL_TAKEN`. One string, no second thing to keep in step.

An already-translated message also works, because a string that resolves
to no key is used as written:

```ts
throw new HttpError(403, req.t("registrationClosed", { mode }), {
  code: "REGISTRATION_CLOSED",   // no key to derive from, so name it
});
```

Prefer the key form. Pass `vars` when the key interpolates
(`{ vars: { name } }`), and `code` only to override what the key derives.

### Several fields at once

A form wrong in three places should say so once:

```ts
const issues: FieldIssue[] = [];
if (!email) issues.push({ field: "email", message: "emailRequired" });
if (!password) issues.push({ field: "password", message: "passwordTooShort" });
if (issues.length > 0) throw new ValidationError(issues);   // 422
```

## meta.action

`action` tells the client what to do next — `complete_profile`,
`redirect_to_signin`. Declare the set and every call site is checked:

```ts
declare module "@tulipes/core/http" {
  interface MetaActions {
    complete_profile: true;
    redirect_to_signin: true;
  }
}
```

Until you declare any, `action` accepts any string.

## Rules

- **Never `res.json` in a handler.** It ships a raw, unenveloped body.
  Development logs a warning naming the route when this happens; nothing
  catches it in production.
- **Never build an error body by hand.** `throw` and let the terminal
  handler shape it — a hand-rolled 500 leaks what the framework hides.
- `data` and `errors` are mutually exclusive: a failure carries `data:
  null`, whatever was passed.
- **Field names on the wire are `snake_case`**, envelope and payload
  alike. → skill `tulipes-model`
- Codes are stable and never translated; messages are translated and
  never parsed. A client branches on `code`.
