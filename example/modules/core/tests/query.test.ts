import { describe, expect, test } from "vitest";

import { LIMITS, listQuery, type QueryPolicy } from "../helpers/query/index.ts";

/**
 * The grammar and the policy, with no app and no database: a query string
 * in, an AST or issues with paths out. The paths are what a client sees in
 * the 400 envelope, so they are asserted exactly.
 */
const policy: QueryPolicy = {
  search: ["email", "name"],
  filter: {
    role: ["=", "in"],
    email: ["=", "like", "starts"],
    age: { type: "number", ops: ["=", "!=", ">", ">=", "<", "<=", "in", "nin"] },
    active: { type: "boolean", ops: ["=", "exists"] },
    created_at: { type: "date", ops: [">", "<"] },
    owner: { type: "id", ops: ["="] },
  },
  sort: ["created_at", "email"],
  fields: ["email", "role", "created_at"],
  resolve: {
    sessions: { fields: ["ip", "created_at"], sort: ["created_at"], maxLimit: 10 },
    credential: { fields: ["version"], resolve: { user: { fields: ["email"] } } },
  },
  group: ["role", "active"],
};

const schema = listQuery(policy);
const q = (params: Record<string, unknown>) => Object.fromEntries(
  Object.entries(params).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
);

function parse(params: Record<string, unknown>) {
  return schema.safeParse(q(params));
}

function issues(params: Record<string, unknown>): Array<[string, string]> {
  const result = parse(params);
  if (result.success) throw new Error("expected issues, got " + JSON.stringify(result.data));
  return result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

describe("grammar", () => {
  test("an empty query is the empty AST plus the policy", () => {
    expect(parse({})).toMatchObject({ success: true, data: { sort: [], resolve: [], group: [], policy } });
  });

  test("page and per_page are not the grammar's business and are dropped", () => {
    const result = parse({ page: "2", per_page: "50" });
    expect(result.success && "page" in result.data).toBe(false);
  });

  test("sort accepts one pair or a list of pairs", () => {
    expect(parse({ sort: ["email", "asc"] }).data?.sort).toEqual([{ field: "email", direction: "asc" }]);
    expect(parse({ sort: [["created_at", "desc"], ["email", "asc"]] }).data?.sort).toEqual([
      { field: "created_at", direction: "desc" },
      { field: "email", direction: "asc" },
    ]);
  });

  test("the proposal's nesting examples parse", () => {
    const or = parse({ filter: [["or", ["age", ">", 30], ["and", ["email", "like", "John"], ["role", "=", "admin"]]]] });
    expect(or.data?.filter).toEqual({ kind: "and", items: [{
      kind: "or",
      items: [
        { kind: "cmp", field: "age", op: ">", value: 30 },
        { kind: "and", items: [
          { kind: "cmp", field: "email", op: "like", value: "John" },
          { kind: "cmp", field: "role", op: "=", value: "admin" },
        ] },
      ],
    }] });
    const and = parse({ filter: [["and", ["age", ">", 30], ["or", ["email", "like", "John"], ["role", "=", "admin"]]]] });
    expect(and.data?.filter).toMatchObject({ kind: "and", items: [{ kind: "and", items: [{ field: "age" }, { kind: "or" }] }] });
  });

  test("several top-level conditions are an implicit and", () => {
    expect(parse({ filter: [["age", ">", 30], ["role", "=", "admin"]] }).data?.filter).toMatchObject({ kind: "and", items: [{ field: "age" }, { field: "role" }] });
    // One condition is still wrapped, so every path into the AST mirrors the JSON.
    expect(parse({ filter: [["age", ">", 30]] }).data?.filter).toMatchObject({ kind: "and", items: [{ field: "age", op: ">", value: 30 }] });
  });

  test("a resolve entry is a name or [name, options], nested", () => {
    const result = parse({ resolve: ["sessions", ["credential", { fields: ["version"], resolve: [["user", { fields: ["email"] }]] }]] });
    expect(result.data?.resolve).toEqual([
      { relation: "sessions" },
      { relation: "credential", fields: ["version"], resolve: [{ relation: "user", fields: ["email"] }] },
    ]);
  });

  test.each([
    ["bad JSON", { filter: "[[age" }, ["filter", "invalid JSON"]],
    ["a parameter over the length limit", { fields: "x".repeat(LIMITS.paramLength + 1) }, ["fields", expect.stringMatching(/<=2048/)]],
    ["a field name carrying $", { filter: [["$where", "=", 1]] }, ["filter.0", expect.stringMatching(/condition/)]],
    ["an object as a value", { filter: [["age", "=", { $gt: "" }]] }, ["filter.0", expect.stringMatching(/condition/)]],
    ["an unknown operator", { filter: [["age", "~", 1]] }, ["filter.0", expect.stringMatching(/condition/)]],
    ["an empty and", { filter: [["and"]] }, ["filter", expect.stringMatching(/at least one/)]],
    ["search too long", { search: "x".repeat(LIMITS.searchLength + 1) }, ["search", expect.stringMatching(/<=128/)]],
    ["too many sort keys", { sort: [["a", "asc"], ["b", "asc"], ["c", "asc"], ["d", "asc"]] }, ["sort", expect.stringMatching(/sort is/)]],
    ["too many group keys", { group: ["a", "b", "c", "d"] }, ["group", expect.stringMatching(/<=3/)]],
    ["an unknown resolve option", { resolve: [["sessions", { populate: true }]] }, ["resolve.0.1", 'Unrecognized key: "populate"']],
  ])("refuses %s at the parameter", (_name, params, [path, message]) => {
    expect(issues(params)).toEqual([[path, message]]);
  });

  test("filter depth and leaf count are capped", () => {
    const deep = [["or", ["and", ["or", ["and", ["age", ">", 1]]]]]];
    expect(issues({ filter: deep })).toEqual([["filter", `filter nests deeper than ${LIMITS.filterDepth} levels`]]);
    const wide = Array.from({ length: LIMITS.filterLeaves + 1 }, () => ["age", ">", 1]);
    expect(issues({ filter: wide })).toEqual([["filter", `filter has more than ${LIMITS.filterLeaves} conditions`]]);
  });

  test("resolve depth is capped", () => {
    const nested = [["credential", { resolve: [["user", { resolve: [["x", { resolve: ["y"] }]] }]] }]];
    expect(issues({ resolve: nested })).toEqual([["resolve", `resolve nests deeper than ${LIMITS.resolveDepth} levels`]]);
  });
});

describe("policy", () => {
  test.each([
    ["a field that is not filterable", { filter: [["password_hash", "=", "x"]] }, "filter.0.0", '"password_hash" is not filterable'],
    ["an operator not allowed on the field", { filter: [["role", "like", "adm"]] }, "filter.0.1", '"like" is not allowed on "role"'],
    ["a value of the wrong type", { filter: [["age", ">", "30"]] }, "filter.0.2", "age: value must be a number"],
    ["in with an empty list", { filter: [["role", "in", []]] }, "filter.0.2", "role: in takes a non-empty list"],
    ["in with a wrong item", { filter: [["age", "in", [1, "2"]]] }, "filter.0.2", "age: every value must be a number"],
    ["a list where one value is expected", { filter: [["age", ">", [1]]] }, "filter.0.2", "age: > takes a single value"],
    ["null outside = and !=", { filter: [["age", ">", null]] }, "filter.0.2", "age: > does not take null"],
    ["exists with a non-boolean", { filter: [["active", "exists", 1]] }, "filter.0.2", "active: exists takes true or false"],
    ["a long like pattern", { filter: [["email", "like", "x".repeat(LIMITS.patternLength + 1)]] }, "filter.0.2", `email: pattern longer than ${LIMITS.patternLength} characters`],
    ["a bad date", { filter: [["created_at", ">", "yesterday"]] }, "filter.0.2", "created_at: value must be a date"],
    ["a bad object id", { filter: [["owner", "=", "42"]] }, "filter.0.2", "owner: value must be a id"],
    ["a sort key outside the policy", { sort: [["password_hash", "asc"]] }, "sort.0", 'cannot sort by "password_hash"'],
    ["a projected field outside the policy", { fields: ["email", "password_hash"] }, "fields.1", '"password_hash" is not a field of this endpoint'],
    ["a relation outside the policy", { resolve: ["user"] }, "resolve.0", '"user" cannot be resolved here'],
    ["a resolved field outside the relation's policy", { resolve: [["sessions", { fields: ["ip", "refresh_jti"] }]] }, "resolve.0.1.fields.1", '"refresh_jti" is not a field of this endpoint'],
    ["a resolve sort outside the relation's policy", { resolve: [["sessions", { sort: [["ip", "asc"]] }]] }, "resolve.0.1.sort.0", 'cannot sort by "ip"'],
    ["a resolve limit over the relation's max", { resolve: [["sessions", { limit: 11 }]] }, "resolve.0.1.limit", "sessions resolves at most 10"],
    ["a nested relation outside the policy", { resolve: [["credential", { resolve: ["sessions"] }]] }, "resolve.0.1.resolve.0", '"sessions" cannot be resolved here'],
    ["a group key outside the policy", { group: ["email"] }, "group.0", 'cannot group by "email"'],
    ["fields together with group", { group: ["role"], fields: ["email"] }, "fields", "fields cannot be combined with group"],
    ["resolve together with group", { group: ["role"], resolve: ["sessions"] }, "resolve", "resolve cannot be combined with group"],
    ["sort by a non-key while grouped", { group: ["role"], sort: [["email", "asc"]] }, "sort.0", 'cannot sort by "email"'],
  ])("refuses %s with the path", (_name, params, path, message) => {
    expect(issues(params)).toEqual([[path, message]]);
  });

  test("paths inside nested conditions point into the client's JSON", () => {
    expect(issues({ filter: [["or", ["age", ">", 30], ["and", ["email", "like", "j"], ["secret", "=", 1]]]] }))
      .toEqual([["filter.0.2.2.0", '"secret" is not filterable']]);
  });

  test("search needs a policy", () => {
    expect(parse({ search: "x" }).success).toBe(true);
    expect(listQuery({}).safeParse({ search: "x" })).toMatchObject({ success: false, error: { issues: [{ path: ["search"], message: "search is not supported here" }] } });
  });

  test("grouped queries may sort by a key or by count", () => {
    expect(parse({ group: ["role", "active"], sort: [["count", "desc"], ["role", "asc"]] }).success).toBe(true);
  });

  test("the whole example request is accepted", () => {
    const result = parse({
      search: "john",
      sort: [["created_at", "desc"], ["email", "asc"]],
      filter: [["role", "=", "admin"], ["or", ["email", "like", "@k13"], ["created_at", ">", "2026-01-01"]]],
      fields: ["email", "role", "created_at"],
      resolve: [["sessions", { fields: ["ip", "created_at"], sort: [["created_at", "desc"]], limit: 5 }]],
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ search: "john", fields: ["email", "role", "created_at"], resolve: [{ relation: "sessions", limit: 5 }] });
  });
});

test("inherited names are not declared fields or relations: a 400 issue, never a TypeError", () => {
  for (const query of [{ resolve: '["constructor"]' }, { resolve: '[["__proto__", {"fields": ["x"]}]]' }, { filter: '[["toString", "=", "x"]]' }, { filter: '[["constructor", "=", "x"]]' }]) {
    const result = schema.safeParse(query);
    expect(result.success, JSON.stringify(query)).toBe(false);
    expect(result.error!.issues[0]!.message, JSON.stringify(query)).toMatch(/is not filterable|cannot be resolved here/);
  }
});
