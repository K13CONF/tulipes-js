import { Types, type PipelineStage, type PopulateOptions, type RootFilterQuery } from "mongoose";

import type { Condition, Operator, Primitive, Resolve, SortKey } from "../grammar.ts";
import type { FieldType, FilterRule, ParsedListQuery, QueryPolicy, ResolvePolicy } from "../policy.ts";

/**
 * One pure builder per stage. Each reads the parsed query (and the policy
 * it carries) and returns its fragment; none knows about the others. The
 * runners in run.ts assemble them, so the order of a pipeline is written
 * in exactly one place.
 *
 *   match    { $and: [system, filter, search] }
 *   sort     { field: 1 | -1 } with an _id tiebreaker, or key/count when grouped
 *   group    the $group / $project stages for flat buckets or a tree
 *   page     $skip, $limit
 *   project  { field: 1 }                      plain list only
 *   resolve  populate options                  plain list only
 */

type Filter = RootFilterQuery<unknown>;
type Value = Primitive | Primitive[];

// ── match ────────────────────────────────────────────────────────────────

/** What a client may never override: soft-delete scope, a tenant, an owner. */
export function matchStage(query: ParsedListQuery, system?: Filter): Filter {
  const parts = [
    system && Object.keys(system).length ? system : undefined,
    query.filter && condition(query.filter, query.policy.filter ?? {}),
    query.search !== undefined ? search(query.search, query.policy.search) : undefined,
  ].filter((part): part is Filter => part !== undefined);
  // A user filter can only ever live inside $and, never beside the system query's keys.
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { $and: parts };
}

function condition(node: Condition, rules: NonNullable<QueryPolicy["filter"]>): Filter {
  if (node.kind === "cmp") {
    const declared = rules[node.field]!;
    const type = Array.isArray(declared) ? "string" : (declared as FilterRule).type;
    return { [node.field]: OPERATORS[node.op](coerce(type, node.value)) };
  }
  const items = node.items.map((item) => condition(item, rules));
  return items.length === 1 ? items[0]! : { [`$${node.kind}`]: items };
}

/** The only place an operator becomes Mongo. A new operator is one entry here and one in the grammar. */
const OPERATORS: Record<Operator, (value: unknown) => unknown> = {
  "=": (value) => value,
  "!=": (value) => ({ $ne: value }),
  ">": (value) => ({ $gt: value }),
  ">=": (value) => ({ $gte: value }),
  "<": (value) => ({ $lt: value }),
  "<=": (value) => ({ $lte: value }),
  in: (value) => ({ $in: value }),
  nin: (value) => ({ $nin: value }),
  like: (value) => ({ $regex: escapeRegex(String(value)), $options: "i" }),
  starts: (value) => ({ $regex: `^${escapeRegex(String(value))}` }),
  exists: (value) => ({ $exists: value }),
};

function coerce(type: FieldType, value: Value): unknown {
  if (Array.isArray(value)) return value.map((item) => coerce(type, item));
  if (value === null || typeof value === "boolean") return value;
  if (type === "date") return new Date(value);
  if (type === "id") return new Types.ObjectId(String(value));
  return value;
}

function search(term: string, fields: QueryPolicy["search"]): Filter {
  // $text needs a text index on the model, and must sit in the first $match.
  if (fields === "text") return { $text: { $search: term } };
  const pattern = { $regex: escapeRegex(term), $options: "i" };
  const clauses = (fields ?? []).map((field) => ({ [field]: pattern }));
  return clauses.length === 1 ? clauses[0]! : { $or: clauses };
}

/** Every regex is built from an escaped literal: a client cannot write a pattern, so no ReDoS. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── sort ─────────────────────────────────────────────────────────────────

const order = (key: SortKey): 1 | -1 => (key.direction === "asc" ? 1 : -1);

/** Plain list: the requested keys, then _id so pages never overlap or skip a row. */
export function sortStage(query: ParsedListQuery): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};
  for (const key of query.sort) sort[key.field] = order(key);
  sort._id ??= 1;
  return sort;
}

/**
 * Grouped flat list: sort fields are bucket keys (`key.role`) or `count`;
 * the remaining keys break ties in their declared order, so pages are stable.
 */
export function groupSortStage(query: ParsedListQuery): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};
  for (const key of query.sort) sort[key.field === "count" ? "count" : `key.${key.field}`] = order(key);
  for (const field of query.group) sort[`key.${field}`] ??= 1;
  return sort;
}

// ── group ────────────────────────────────────────────────────────────────

/** `{ role: "$role", "address.city": … }` as a nested _id, so `key` mirrors the document's shape. */
function groupId(fields: readonly string[]): Record<string, unknown> {
  const id: Record<string, unknown> = {};
  for (const field of fields) setPath(id, field.split("."), `$${field}`);
  return id;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    target[head!] = value;
    return;
  }
  target[head!] ??= {};
  setPath(target[head!] as Record<string, unknown>, rest, value);
}

/** One row per distinct combination: `{ key: { role, active }, count }`. */
export function groupStages(query: ParsedListQuery): PipelineStage[] {
  return [
    { $group: { _id: groupId(query.group), count: { $sum: 1 } } },
    { $project: { _id: 0, key: "$_id", count: 1 } },
  ];
}

/**
 * Tree output: `{ key, count, groups: [{ key, count, groups? }] }`, built
 * by folding the flat buckets once per level, deepest first. Keys travel
 * as positional aliases (k0, k1, k2), so a dotted field never becomes a
 * path inside `_id`. The pipeline is:
 *
 *   $group   by k0..kn          count each combination
 *   $sort    level n            order the children before they're pushed
 *   $group   by k0..kn-1        push { key: kn, count } as groups, sum count
 *   …        once per level up to k1
 *   $project { key: k0, count, groups }
 *
 * A sort key applies to the level it names; `count` applies at every
 * level; a level nothing names is ordered by its key, ascending.
 */
export function treeStages(query: ParsedListQuery): PipelineStage[] {
  const fields = query.group;
  const alias = (index: number) => `k${index}`;
  const ids = (count: number) => Object.fromEntries(fields.slice(0, count).map((_, index) => [alias(index), `$_id.${alias(index)}`]));

  const stages: PipelineStage[] = [
    { $group: { _id: Object.fromEntries(fields.map((field, index) => [alias(index), `$${field}`])), count: { $sum: 1 } } },
  ];
  for (let level = fields.length - 1; level >= 1; level--) {
    const child = { key: `$_id.${alias(level)}`, count: "$count", ...(level < fields.length - 1 && { groups: "$groups" }) };
    stages.push(
      { $sort: levelSort(query, fields[level]!, `_id.${alias(level)}`) },
      { $group: { _id: ids(level), count: { $sum: "$count" }, groups: { $push: child } } },
    );
  }
  stages.push({ $project: { _id: 0, key: `$_id.${alias(0)}`, count: 1, ...(fields.length > 1 && { groups: 1 }) } });
  return stages;
}

function levelSort(query: ParsedListQuery, field: string, path: string): Record<string, 1 | -1> {
  const sort: Record<string, 1 | -1> = {};
  for (const key of query.sort) {
    if (key.field === "count") sort.count = order(key);
    else if (key.field === field) sort[path] = order(key);
  }
  sort[path] ??= 1;
  return sort;
}

/** The top level of a tree: its own key or `count` as asked, then the key ascending. */
export function treeSortStage(query: ParsedListQuery): Record<string, 1 | -1> {
  return levelSort(query, query.group[0]!, "key");
}

/** What a page of a tree counts: its top-level keys. */
export function treeCountStages(query: ParsedListQuery): PipelineStage[] {
  return [{ $group: { _id: `$${query.group[0]!}` } }, { $count: "total" }];
}

// ── page ─────────────────────────────────────────────────────────────────

export function pageStages(page: { skip: number; per_page: number }): PipelineStage[] {
  return [{ $skip: page.skip }, { $limit: page.per_page }];
}

// ── project ──────────────────────────────────────────────────────────────

/**
 * The requested fields, else the policy's, else nothing (the whole
 * document). `_id` always comes back: it is the row's identity, and the
 * parent key a populated relation is matched on.
 */
export function projectStage(query: ParsedListQuery): Record<string, 1> | undefined {
  const fields = query.fields ?? query.policy.fields;
  return fields?.length ? Object.fromEntries(fields.map((field) => [field, 1 as const])) : undefined;
}

// ── resolve ──────────────────────────────────────────────────────────────

/**
 * `populate()` options. Without a limit a relation is one query for the
 * whole page. A limit is per parent (`perDocumentLimit`), which costs one
 * query per parent: that is why the policy caps it with `maxLimit`.
 */
export function resolveStage(list: readonly Resolve[], policies: Record<string, ResolvePolicy> | undefined): PopulateOptions[] {
  return list.map((entry) => {
    const policy = policies?.[entry.relation];
    const fields = entry.fields ?? policy?.fields ?? [];
    const sort = entry.sort?.length ? Object.fromEntries(entry.sort.map((key) => [key.field, order(key)])) : undefined;
    const limit = entry.limit ?? policy?.maxLimit;
    return {
      path: entry.relation,
      ...(fields.length && { select: fields.join(" ") }),
      ...(sort && { options: { sort } }),
      ...(limit !== undefined && { perDocumentLimit: limit }),
      ...(entry.resolve?.length && { populate: resolveStage(entry.resolve, policy?.resolve) }),
    };
  });
}
