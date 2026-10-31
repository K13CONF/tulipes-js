---
name: tulipes-list-query
description: Use when a list endpoint in a Tulipes app should let clients search, filter, sort, choose fields, populate relations or group rows — or when a list handler is building find()/sort()/populate() from req.query by hand. Covers listQuery(policy), the query grammar, toMongoose/runQuery, the system query and what each costs.
---

# List queries

A list endpoint that clients may shape declares **what** they may shape,
and `@app/core` does the rest: parse, police, compile, run.

```ts
// routes/bo.users.routes.ts
import { listQuery } from "@app/core";

router.get("/directory", rai({
  id: "users:bo:list",
  query: listQuery({
    search: ["email"],                                   // or "text" for a $text index
    filter: {
      role: ["=", "!=", "in"],                           // a bare list is a string field
      created_at: { type: "date", ops: [">", ">=", "<", "<="] },
    },
    sort: ["created_at", "email"],
    fields: ["email", "role", "created_at"],             // also the default projection
    resolve: { sessions: { fields: ["ip", "created_at"], sort: ["created_at"], maxLimit: 10 } },
    group: ["role"],
  }),
}), users.list());
```

```ts
// controllers/bo.users.controllers.ts
import { runQuery, toMongoose, type ParsedListQuery } from "@app/core";

const compiled = toMongoose(req.query as unknown as ParsedListQuery, req.page, {
  system: { tenant: req.auth.tenant },                   // ANDed outside the client's query
  // maxTimeMS: 15_000,                                  // only to override the app-wide default
});
const { data, total_items } = await runQuery(this.#ctx.models!.get("User"), compiled);
res.respond({ data, meta: total_items === undefined ? {} : { total_items } });
```

App-wide defaults come from `config.pagination` (`maxTimeMs`, the ceiling
for each find, count or aggregate): the core module's
`list-query.bootstrap.ts` hands them to `configureListQueries()` at boot.
An option passed to `toMongoose()` wins for that call; `system` is never
global, because it belongs to the endpoint.

`rai` runs the policy after the access check, so `req.query` is the
parsed AST by the time the handler sees it. Anything outside the policy is
a 422 naming the value: `{ field: "filter.0.0", message: '"password_hash" is not filterable' }`.
The generated spec lists each endpoint's allowlist under its parameters.

## What a client sends

Every parameter but `search` and `tree` is JSON in the query string:

| Param | Shape |
|---|---|
| `page`, `per_page` | as everywhere: `req.page`, clamped by `config.pagination` |
| `search` | one term, matched on the policy's `search` fields |
| `sort` | `["email","asc"]` or `[["created_at","desc"],["email","asc"]]` |
| `filter` | `[["role","=","admin"],["or",["age",">",30],["and",["email","like","jo"],["role","!=","x"]]]]` |
| `fields` | `["email","role"]` |
| `resolve` | `["sessions"]` or `[["sessions",{"fields":["ip"],"sort":[["created_at","desc"]],"limit":5}]]` |
| `group` | `["role","status"]`: rows become `{ key: { role, status }, count }` |
| `tree` | `true` with `group`: rows become `{ key, count, groups: [...] }` |

Operators: `= != > >= < <= in nin like starts exists`. Values are strings,
numbers, booleans or null (lists for `in`/`nin`); an object is refused, so
no Mongo operator can arrive from a client. Field types in the policy
(`string number boolean date id`) are checked and coerced, so `created_at`
compares as a Date and `owner` as an ObjectId.

## Rules

- **Only expose what is indexed.** A filter, sort, search or group on an
  unindexed field is a collection scan. The engine can't know; the policy
  author does.
- **The system query is the only safe place for scoping.** Tenant, owner,
  visibility: pass them as `system`, never as a default filter the client
  could replace. Soft-deleted rows need nothing: the base plugin already
  excludes them from find, count and aggregate.
- **`resolve` with a limit costs one query per row** (`perDocumentLimit`),
  so keep `maxLimit` small. Without a limit, a relation is one query for
  the page. Filtering inside a resolve is not supported.
- **Grouping is a full scan of the matched set.** Group on low-cardinality
  fields, behind a filter where you can. `fields` and `resolve` are refused
  with `group`.
- **`count: false`** in the policy skips the second query when a total
  isn't worth it; `meta` then has no `total_items`.
- `search: "text"` needs a text index on the model. With `group` on a
  soft-deleting model it fails, because MongoDB wants `$text` in the first
  pipeline stage and the plugin's own `$match` comes first.

## Extending

- A new operator: one entry in the grammar's `operators` list
  (`helpers/query/grammar.ts`) and one in `OPERATORS`
  (`helpers/query/mongoose/stages.ts`).
- Another database: write a translator from the same `ListQuery` AST; the
  grammar and the policy don't change.
- Limits (depth 3, 20 conditions, 3 sort keys, 3 group keys…) are
  `LIMITS` in `grammar.ts`.
