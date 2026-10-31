import { Types } from "mongoose";
import { describe, expect, test } from "vitest";

import { escapeRegex, listQuery, toMongoose, type ParsedListQuery, type QueryPolicy } from "../helpers/query/index.ts";

/**
 * The Mongoose translation with no database: a query string in, the exact
 * filter, sort, populate options or pipeline out. If a stage changes shape,
 * a test here says which.
 */
const policy: QueryPolicy = {
  search: ["email", "name"],
  filter: {
    role: ["=", "!=", "in", "nin"],
    email: ["=", "like", "starts", "exists"],
    age: { type: "number", ops: [">", ">=", "<", "<="] },
    created_at: { type: "date", ops: [">"] },
    owner: { type: "id", ops: ["=", "in"] },
    deleted_at: { type: "date", ops: ["exists"] },
  },
  sort: ["created_at", "email"],
  fields: ["email", "role"],
  resolve: { sessions: { fields: ["ip", "created_at"], sort: ["created_at"], maxLimit: 10, resolve: { device: { fields: ["name"] } } } },
  group: ["role", "status", "address.city"],
};

const page = { skip: 40, per_page: 20 };

function parsed(params: Record<string, unknown>, rules: QueryPolicy = policy): ParsedListQuery {
  const raw = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
  const result = listQuery(rules).safeParse(raw);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

const compile = (params: Record<string, unknown>, options = {}, rules?: QueryPolicy) => toMongoose(parsed(params, rules), page, options);

function list(params: Record<string, unknown>, options = {}, rules?: QueryPolicy) {
  const compiled = compile(params, options, rules);
  if (compiled.mode !== "list") throw new Error("expected a list");
  return compiled;
}

function grouped(params: Record<string, unknown>, options = {}) {
  const compiled = compile(params, options);
  if (compiled.mode !== "group") throw new Error("expected a group");
  return compiled;
}

describe("match", () => {
  test.each([
    ["=", ["role", "=", "admin"], { role: "admin" }],
    ["!=", ["role", "!=", "admin"], { role: { $ne: "admin" } }],
    [">", ["age", ">", 30], { age: { $gt: 30 } }],
    [">=", ["age", ">=", 30], { age: { $gte: 30 } }],
    ["<", ["age", "<", 30], { age: { $lt: 30 } }],
    ["<=", ["age", "<=", 30], { age: { $lte: 30 } }],
    ["in", ["role", "in", ["a", "b"]], { role: { $in: ["a", "b"] } }],
    ["nin", ["role", "nin", ["a"]], { role: { $nin: ["a"] } }],
    ["like", ["email", "like", "jo.n"], { email: { $regex: "jo\\.n", $options: "i" } }],
    ["starts", ["email", "starts", "a+b"], { email: { $regex: "^a\\+b" } }],
    ["exists", ["email", "exists", false], { email: { $exists: false } }],
    ["= null", ["role", "=", null], { role: null }],
  ])("%s", (_name, leaf, expected) => {
    expect(list({ filter: [leaf] }).match).toEqual(expected);
  });

  test("dates and ids are coerced from their JSON form", () => {
    expect(list({ filter: [["created_at", ">", "2026-01-01"]] }).match).toEqual({ created_at: { $gt: new Date("2026-01-01") } });
    const id = "64b7f0c2a1b2c3d4e5f60718";
    const { match } = list({ filter: [["owner", "in", [id]]] });
    expect(match).toEqual({ owner: { $in: [new Types.ObjectId(id)] } });
  });

  test("and / or nest as written; a lone condition is not wrapped", () => {
    expect(list({ filter: [["role", "=", "a"], ["or", ["age", ">", 1], ["and", ["email", "like", "x"], ["age", "<", 9]]]] }).match).toEqual({
      $and: [
        { role: "a" },
        { $or: [{ age: { $gt: 1 } }, { $and: [{ email: { $regex: "x", $options: "i" } }, { age: { $lt: 9 } }] }] },
      ],
    });
  });

  test("search ORs the policy's fields with an escaped, case-insensitive pattern", () => {
    expect(list({ search: "a.b" }).match).toEqual({
      $or: [{ email: { $regex: "a\\.b", $options: "i" } }, { name: { $regex: "a\\.b", $options: "i" } }],
    });
  });

  test("search on a text index is $text", () => {
    expect(list({ search: "john doe" }, {}, { search: "text" }).match).toEqual({ $text: { $search: "john doe" } });
  });

  test("the system query is ANDed outside the user's, which cannot replace it", () => {
    const system = { deleted_at: null, tenant: "t1" };
    expect(list({ filter: [["deleted_at", "exists", true]], search: "x" }, { system }).match).toEqual({
      $and: [
        system,
        { deleted_at: { $exists: true } },
        { $or: [{ email: { $regex: "x", $options: "i" } }, { name: { $regex: "x", $options: "i" } }] },
      ],
    });
    expect(list({}, { system }).match).toEqual(system);
    expect(list({}).match).toEqual({});
  });

  test("regex escaping covers every metacharacter", () => {
    const nasty = ".*+?^${}()|[]\\";
    expect(new RegExp(escapeRegex(nasty)).test(nasty)).toBe(true);
    expect(escapeRegex("(a+)+$")).toBe("\\(a\\+\\)\\+\\$");
  });
});

describe("plain list", () => {
  test("sort keeps the requested order and ends on _id", () => {
    expect(list({ sort: [["email", "asc"], ["created_at", "desc"]] }).sort).toEqual({ email: 1, created_at: -1, _id: 1 });
    expect(Object.keys(list({ sort: [["email", "asc"], ["created_at", "desc"]] }).sort)).toEqual(["email", "created_at", "_id"]);
    expect(list({}).sort).toEqual({ _id: 1 });
  });

  test("projection is the requested fields, else the policy's", () => {
    expect(list({ fields: ["email"] }).project).toEqual({ email: 1 });
    expect(list({}).project).toEqual({ email: 1, role: 1 });
    expect(list({}, {}, { filter: {} }).project).toBeUndefined();
  });

  test("page, count and time limit", () => {
    expect(list({})).toMatchObject({ skip: 40, limit: 20, count: true, maxTimeMS: 5_000, populate: [] });
    expect(list({}, { maxTimeMS: 250 }, { ...policy, count: false })).toMatchObject({ count: false, maxTimeMS: 250 });
  });

  test("resolve: policy fields by default, per-parent limit capped by the policy, nested", () => {
    expect(list({ resolve: ["sessions"] }).populate).toEqual([
      { path: "sessions", select: "ip created_at", perDocumentLimit: 10 },
    ]);
    expect(list({ resolve: [["sessions", { fields: ["ip"], sort: [["created_at", "desc"]], limit: 3, resolve: ["device"] }]] }).populate).toEqual([
      { path: "sessions", select: "ip", options: { sort: { created_at: -1 } }, perDocumentLimit: 3, populate: [{ path: "device", select: "name" }] },
    ]);
  });
});

describe("grouped", () => {
  const match = { $match: { role: { $ne: "x" } } };

  test("flat buckets: match, group, project, sort, skip, limit — and a count of buckets", () => {
    const compiled = grouped({ filter: [["role", "!=", "x"]], group: ["role", "status"], sort: [["count", "desc"]] });
    expect(compiled.pipeline).toEqual([
      match,
      { $group: { _id: { role: "$role", status: "$status" }, count: { $sum: 1 } } },
      { $project: { _id: 0, key: "$_id", count: 1 } },
      { $sort: { count: -1, "key.role": 1, "key.status": 1 } },
      { $skip: 40 },
      { $limit: 20 },
    ]);
    expect(compiled.count).toEqual([match, { $group: { _id: { role: "$role", status: "$status" }, count: { $sum: 1 } } }, { $count: "total" }]);
  });

  test("a dotted key nests in the bucket key, mirroring the document", () => {
    const [, group] = grouped({ group: ["address.city"] }).pipeline;
    expect(group).toEqual({ $group: { _id: { address: { city: "$address.city" } }, count: { $sum: 1 } } });
  });

  test("tree: one ($sort, $group) fold per level below the top, deepest first", () => {
    const compiled = grouped({ group: ["role", "status", "address.city"], tree: "true", sort: [["status", "desc"]] });
    expect(compiled.pipeline).toEqual([
      { $match: {} },
      { $group: { _id: { k0: "$role", k1: "$status", k2: "$address.city" }, count: { $sum: 1 } } },
      { $sort: { "_id.k2": 1 } },
      { $group: { _id: { k0: "$_id.k0", k1: "$_id.k1" }, count: { $sum: "$count" }, groups: { $push: { key: "$_id.k2", count: "$count" } } } },
      { $sort: { "_id.k1": -1 } },
      { $group: { _id: { k0: "$_id.k0" }, count: { $sum: "$count" }, groups: { $push: { key: "$_id.k1", count: "$count", groups: "$groups" } } } },
      { $project: { _id: 0, key: "$_id.k0", count: 1, groups: 1 } },
      { $sort: { key: 1 } },
      { $skip: 40 },
      { $limit: 20 },
    ]);
    expect(compiled.count).toEqual([{ $match: {} }, { $group: { _id: "$role" } }, { $count: "total" }]);
  });

  test("tree with one key has no folds and no groups", () => {
    expect(grouped({ group: ["role"], tree: "true", sort: [["count", "desc"]] }).pipeline).toEqual([
      { $match: {} },
      { $group: { _id: { k0: "$role" }, count: { $sum: 1 } } },
      { $project: { _id: 0, key: "$_id.k0", count: 1 } },
      { $sort: { count: -1, key: 1 } },
      { $skip: 40 },
      { $limit: 20 },
    ]);
  });

  test("count off drops the count pipeline", () => {
    const compiled = toMongoose(parsed({ group: ["role"] }, { ...policy, count: false }), page);
    expect(compiled).not.toHaveProperty("count");
  });
});

describe("app-wide defaults", () => {
  test("configureListQueries sets the default; a call's option overrides it; undefined keeps it", async () => {
    const { configureListQueries, listQueryDefaults } = await import("../helpers/query/index.ts");
    const before = listQueryDefaults().maxTimeMS;
    try {
      configureListQueries({ maxTimeMS: 1_234 });
      expect(list({}).maxTimeMS).toBe(1_234);
      expect(grouped({ group: ["role"] }).maxTimeMS).toBe(1_234);
      expect(list({}, { maxTimeMS: 50 }).maxTimeMS).toBe(50);

      configureListQueries({ maxTimeMS: undefined });
      expect(listQueryDefaults().maxTimeMS).toBe(1_234);
    } finally {
      configureListQueries({ maxTimeMS: before });
    }
  });
});
