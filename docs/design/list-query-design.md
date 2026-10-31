# List queries — a controlled query language for list endpoints

Status: **approved 2026-10-31, not started.** Decisions taken: app code in
`@app/core` (production preset); `per_page` stays; the named `resolve`
form; JSON params in the query string; `search` added; `group` in v1 as an
aggregation with one builder per pipeline stage.

## What exists today

- `req.page` (`page`, `per_page`, `skip`) is parsed and clamped by core from
  `config.pagination` for every request (`packages/core/src/http/pagination.ts`).
- `rai({ query: zodSchema })` validates `req.query`, replaces it with the
  parsed value, reports issues with a path and an i18n key, and the spec
  generator describes the schema (`packages/core/src/http/rai.ts:280-314`).
- `res.respond({ data, meta: { total_items } })` fills `page`, `per_page`,
  `total_pages`.
- Every list handler builds its own `find().sort().skip().limit()`
  (`example/modules/agents/helpers/runs.ts:75`, users, auth).
- Express 5's default query parser is "simple": `?a[b]=1` is **not** nested.

Pagination, validation plumbing and the response envelope are solved. The
new work is the grammar, the per-endpoint policy, and the Mongoose
translation.

## Where it lives

`example/modules/core/helpers/query/`, app code shipped by the production
preset. Not the `security` module (helmet, CORS, proxy trust, rate limiter:
the sys tier that runs before routing) and not `@tulipes/core` (core owns
no infrastructure, and the translator needs Mongoose). Generated apps are
the user's code, and a grammar is exactly what an app extends: a custom
operator, a tenant field, a SQL translator.

Minimal preset: left out; it has no filtered list endpoints.

## The grammar

Each parameter is **JSON in the query string** (URL-encoded) except
`search`, a plain string. Express's simple parser cannot nest, and the
syntax is already JSON arrays. One request:

```
GET /api/v1/bo/users
  ?page=2&per_page=50
  &search=john
  &sort=[["created_at","desc"],["email","asc"]]
  &filter=[["role","=","admin"],["or",["email","like","@k13"],["created_at",">","2026-01-01"]]]
  &fields=["email","role","created_at"]
  &resolve=[["sessions",{"fields":["ip","created_at"],"sort":[["created_at","desc"]],"limit":5}]]
```

| Param | Shape | Notes |
|---|---|---|
| `page`, `per_page` | integers | Unchanged: `req.page` already does this. |
| `search` | string ≤ 128 chars | One term, matched against the fields the policy names (below). ANDed with `filter`. |
| `sort` | `[[field, "asc"\|"desc"], …]` | A single pair `["name","asc"]` is accepted and normalised. Max 3 keys. With `group`, sortable keys are the grouped fields and `count`. |
| `filter` | condition tree | Leaf `[field, op, value]`; node `["and"\|"or", …conditions]`. Top level is an implicit `and`. Max depth 3, max 20 leaves. |
| `fields` | `[field, …]` | Projection. Absent means the policy's `fields` default. Refused with `group`. |
| `resolve` | `[[relation, { fields?, sort?, limit? }], …]` | Populate, depth ≤ 3. No `filter` inside a resolve (see translation). Refused with `group`. |
| `group` | `[field, …]` | Buckets by every listed field; order is the key order. Response rows become `{ key: { status, role }, count }`. |

**Why `group` is flat.** The proposed nested form
(`[["age"], ["status", ["sort", …]]]`) and SQL `GROUP BY age, status` carry
the same information: a bucket per distinct combination. The flat form
has one shape to validate, one `$group` stage, and sorting by any key field
or by `count` replaces per-level sort. A client that wants a tree folds the
flat buckets in a dozen lines. A `tree: true` output option is deferred.

Operators, v1: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `nin`, `like`
(contains, case-insensitive), `starts` (prefix; the one that can use an
index), `exists`. Values are **primitives only** (string, number, boolean,
null) or arrays of primitives for `in`/`nin`. An object value is a 400.
This one rule is what makes the thing safe: `{"$gt": ""}` can never reach
Mongo, because user input only lands in a leaf's `value`, under an operator
the translator chose.

## The policy: allowlist per endpoint

The parsed tree is half of it. Without a policy, `filter` on
`password_hash` or `resolve` of `credential → user` leaks exactly what the
model hides. Every list route declares what it accepts:

```ts
// routes/bo/bo.users.routes.ts
router.get("/users", rai({
  id: "users:bo:list",
  query: listQuery({
    search: ["email", "name"],                       // regex contains on these; or search: "text" for a $text index
    filter: { role: ["=", "in"], email: ["=", "like", "starts"], created_at: ["=", ">", ">=", "<", "<="] },
    sort: ["created_at", "email"],
    fields: ["email", "role", "created_at"],
    resolve: { sessions: { fields: ["ip", "created_at"], maxLimit: 10, sort: ["created_at"] } },
    group: ["role", "status"],
  }),
}), users.list());
```

`listQuery(policy)` returns a `ValidatableSchema` (`safeParse`), so it slots
into `rai`'s existing `query` segment: same 400 envelope, same issue paths
(`filter[1][2]`), same i18n keys, and the spec generator sees it. No new
middleware, and `req.query` becomes the typed AST, which is the "saved in
the request context" of the proposal.

Each field in `filter` carries its type (`string | number | boolean | date |
id`), declared once in the policy; a value of the wrong type is an issue.
Unknown field, operator not allowed on that field, depth or count over the
limit, `fields`/`resolve` together with `group`: each is one issue with a
path and a message naming the rule.

## Translation: Mongoose, one builder per stage

The translator is a list of **stage builders**. Each is a pure function of
`(ast, policy, options)` that returns its fragment or nothing; none knows
about the others. Two runners assemble them:

```
match    → { $and: [system, filter, search] }      always first; $text must be in the first $match
sort     → { field: 1 | -1, … }                    grouped: keys are "key.<field>" or "count"
group    → $group { _id: { f: "$f", … }, count: { $sum: 1 } } + $project { key: "$_id", count, _id: 0 }
page     → $skip, $limit                            from req.page
project  → { field: 1, … }                          plain list only
resolve  → populate({ path, select, options })      plain list only
```

| Mode | Runner | Pipeline |
|---|---|---|
| plain list | `runList(model, compiled)` | `find(match).sort(sort).skip().limit().select(project).populate(resolve).lean()` in parallel with `countDocuments(match)` |
| grouped | `runGrouped(model, compiled)` | `aggregate([match, group, sort, page])` in parallel with `aggregate([match, group, $count])` for `total_items` |

Two runners instead of one aggregation for both, because `find` + populate
is simpler, lean by default, and the plain list is 95% of requests. Both
read the same `match` and `sort` fragments, so a filter means the same
thing in both modes.

- **System query.** `toMongoose(ast, { system })` ANDs it outside the user
  tree: `{ $and: [system, user] }`. The user cannot override it, because
  there is no user-controlled key at the top level.
- **search.** Policy `search: [fields]` → `$or` of escaped, case-insensitive
  `$regex` over those fields (no index needed; a scan on big collections, as
  the skill doc will say). Policy `search: "text"` → `$text: { $search }`,
  which needs a text index on the model and is why match is always first.
- **like / starts** → `$regex` with the value escaped and capped at 64
  chars: no ReDoS, no client metacharacters. `starts` anchors with `^`.
- **resolve** → `populate({ path, select, options: { sort, limit } })`. One
  extra query per level, not per parent, as long as there's no per-parent
  filter: that is why filters inside a resolve are out of v1 (Mongoose
  applies a populate `match` per parent set and drops sub-docs, not parents).
- **group** → `count` only in v1. Metrics (`sum`, `avg`, `min`, `max` of a
  policy-listed numeric field) are a later `agg` param that lands in the
  same `$group` stage; nothing else changes.
- `maxTimeMS` on every query, from `config.pagination.maxTimeMs` (new key,
  default 5 000).

Translator contract, so a SQL translator can come later without touching
the parser:

```ts
interface QueryTranslator<Out> { translate(ast: ListQuery, options: { system?: unknown }): Out }
```

Operators live in one `Record<Operator, (path, value) => FilterQuery>` map in
the match builder; adding an operator is one entry there plus one in the
grammar's enum.

## Performance, said plainly

- A filter, sort, search or group on an unindexed field is a collection
  scan. The policy author decides which fields are exposed; the skill doc
  says: expose what you indexed, and `$text` search only with a text index.
- `countDocuments` with a filter is itself a scan on big collections. v1
  keeps it; the policy gets `count: false` for endpoints where an absent
  total is fine.
- Grouping is a full scan of the matched set by construction. The group
  policy lists the fields it makes sense on (low cardinality, indexed).
- `per_page` is already clamped by `config.pagination.maxLimit`.
- Limits (depth 3, 20 leaves, 3 sort keys, resolve depth 3, group keys 3,
  value length 256, param length 2 KB, search 128) are constants in
  `grammar.ts`, not config.

## Files

```
example/modules/core/helpers/query/
  grammar.ts          zod schemas for the JSON params → ListQuery AST (discriminated unions), the limits
  policy.ts           QueryPolicy type; listQuery(policy): ValidatableSchema (parse + enforce)
  mongoose/stages.ts  match, sort, group, page, project, resolve builders; the operator map; regex escaping
  mongoose/run.ts     toMongoose(), runList(), runGrouped()
  index.ts            re-exports
example/modules/core/tests/query.test.ts          grammar + policy, table-driven, pure
example/modules/core/tests/query.mongoose.test.ts  stage builders pure; runList/runGrouped against TEST_MONGO_URI
example/modules/users/…                           BO users list adopts it (the reference usage)
packages/cli/templates/claude/skills/tulipes-list-query/SKILL.md  (example/.claude copy kept identical; CI diffs them)
```

Roughly 450 lines of source. No new dependency.

## Sprint items

| Item | Acceptance |
|---|---|
| **Q1 grammar + policy** | `listQuery(policy).safeParse(req.query)` returns the AST or issues with paths. Table tests: every operator; each limit; each policy refusal; the proposal's nesting examples; `search` too long; an object value refused; a bad JSON param refused as `filter: invalid JSON`; `fields` with `group` refused. |
| **Q2 rai + spec** | BO users list uses it. `?filter=[["password_hash","=","x"]]` is a 400 with path `filter[0][0]` and an i18n message. `tulipes spec` describes the params; `tulipes routes` still works offline. |
| **Q3 plain list** | Stage builders pure-tested: system query survives a user filter on the same field; `like` escapes metacharacters; `search` ORs the policy fields; resolve selects only policy fields. Integration: seed users + sessions, run the example request, check rows, `total_items`, populated sessions capped at the policy limit. |
| **Q4 grouped list** | `?group=["role"]&sort=[["count","desc"]]` returns `{ key: { role }, count }` buckets with `total_items` = bucket count; `group=["role","status"]` keys in that order; `count: false` skips the count pipeline. Pure test that the grouped pipeline is exactly `[match, group, sort, skip, limit]`. |
| **Q5 docs** | The skill file (both copies); `example/AGENTS.md` where list endpoints are described; CHANGELOG. `tulipes new module` keeps the plain list; adopting the query is a documented edit in v1. |

Deferred, recorded so they aren't silently dropped: `agg` metrics in
`$group`, `tree` output for groups, filters inside `resolve`, a SQL
translator, cursor pagination (`after` token), `tulipes new module
--query`.

## Prior art, briefly

JSON:API and Directus/Strapi use nested-object query strings
(`filter[age][_gt]=30`), which needs the `qs` parser and reads worse for
`or`. OData has a real string grammar (`$filter=age gt 30 and …`) and
therefore a real parser to maintain. The S-expression JSON here is the
lightest thing that still nests cleanly; the allowlist policy is what
Hasura and PostgREST do with role-based column permissions, only per route.
