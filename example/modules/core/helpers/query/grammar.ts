import { z } from "zod/v4";

/**
 * The list-query grammar: what a client may put in `?search`, `?sort`,
 * `?filter`, `?fields`, `?resolve` and `?group`, parsed into one AST.
 *
 * Every parameter except `search` is JSON in the query string, because
 * Express's default parser does not nest and the syntax is arrays anyway.
 * This file knows nothing about which fields exist: that is the policy's
 * job (policy.ts). It only guarantees shape, and that a value is a
 * primitive, so nothing a client sends can ever become a Mongo operator.
 */

/** Hard limits on one request. Constants, not config: nobody tunes these per environment. */
export const LIMITS = {
  paramLength: 2048,
  searchLength: 128,
  fieldLength: 64,
  sortKeys: 3,
  filterDepth: 3,
  filterLeaves: 20,
  inValues: 50,
  valueLength: 256,
  /** `like` and `starts` patterns: escaped before they reach a regex, and short. */
  patternLength: 64,
  resolveDepth: 3,
  resolveRelations: 10,
  resolveLimit: 100,
  fieldsCount: 64,
  groupKeys: 3,
} as const;

export const operators = ["=", "!=", ">", ">=", "<", "<=", "in", "nin", "like", "starts", "exists"] as const;
export type Operator = (typeof operators)[number];

export type Primitive = string | number | boolean | null;
export type Direction = "asc" | "desc";

export interface SortKey {
  field: string;
  direction: Direction;
}

export type Condition =
  | { kind: "cmp"; field: string; op: Operator; value: Primitive | Primitive[] }
  | { kind: "and" | "or"; items: Condition[] };

export interface Resolve {
  relation: string;
  fields?: string[];
  sort?: SortKey[];
  limit?: number;
  resolve?: Resolve[];
}

/** The parsed request. Arrays are always present, so a translator never checks for undefined. */
export interface ListQuery {
  search?: string;
  sort: SortKey[];
  filter?: Condition;
  fields?: string[];
  resolve: Resolve[];
  group: string[];
  /** Grouped rows as a tree, one level per group key, instead of flat buckets. */
  tree: boolean;
}

// A dotted identifier: never "$", so a field name can't smuggle an operator.
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const field = z.string().max(LIMITS.fieldLength).regex(FIELD, "a field is a dotted identifier");
const direction = z.enum(["asc", "desc"]);
const primitive = z.union([z.string().max(LIMITS.valueLength), z.number(), z.boolean(), z.null()]);

const sortPair = z.tuple([field, direction]).transform(([f, d]): SortKey => ({ field: f, direction: d }));
const sort = z.union(
  [sortPair.transform((key) => [key]), z.array(sortPair).max(LIMITS.sortKeys)],
  { error: 'sort is [field, "asc" | "desc"] or a list of such pairs' },
);

const leaf = z
  .tuple([field, z.enum(operators), z.union([primitive, z.array(primitive).max(LIMITS.inValues)])])
  .transform(([f, op, value]): Condition => ({ kind: "cmp", field: f, op, value }));

const condition: z.ZodType<Condition, unknown> = z.lazy(() =>
  z.union(
    [
      leaf,
      z
        .tuple([z.enum(["and", "or"])])
        .rest(condition)
        .transform(([kind, ...items]): Condition => ({ kind, items })),
    ],
    { error: 'a condition is [field, operator, value] or ["and" | "or", ...conditions]' },
  ),
);

/** Top level is an implicit `and`, kept as such so AST paths mirror the client's JSON. */
const filter = z
  .array(condition)
  .min(1)
  .transform((items): Condition => ({ kind: "and", items }))
  .check((ctx) => {
    if (ctx.issues.length) return;
    const stats = measure(ctx.value, 0);
    if (stats.depth > LIMITS.filterDepth) ctx.issues.push({ code: "custom", input: ctx.value, message: `filter nests deeper than ${LIMITS.filterDepth} levels` });
    if (stats.leaves > LIMITS.filterLeaves) ctx.issues.push({ code: "custom", input: ctx.value, message: `filter has more than ${LIMITS.filterLeaves} conditions` });
    if (stats.empty) ctx.issues.push({ code: "custom", input: ctx.value, message: '"and" / "or" needs at least one condition' });
  });

function measure(node: Condition, depth: number): { depth: number; leaves: number; empty: boolean } {
  if (node.kind === "cmp") return { depth, leaves: 1, empty: false };
  let deepest = depth;
  let leaves = 0;
  let empty = node.items.length === 0;
  for (const item of node.items) {
    const inner = measure(item, depth + 1);
    deepest = Math.max(deepest, inner.depth);
    leaves += inner.leaves;
    empty ||= inner.empty;
  }
  return { depth: deepest, leaves, empty };
}

const resolveList: z.ZodType<Resolve[], unknown> = z.lazy(() =>
  z
    .array(
      z.union(
        [
          field.transform((relation): Resolve => ({ relation })),
          z
            .tuple([
              field,
              z.strictObject({
                fields: z.array(field).min(1).max(LIMITS.fieldsCount).optional(),
                sort: sort.optional(),
                limit: z.number().int().min(1).max(LIMITS.resolveLimit).optional(),
                resolve: resolveList.optional(),
              }),
            ])
            .transform(([relation, options]): Resolve => ({ relation, ...options })),
        ],
        { error: "a resolve entry is a relation name or [relation, { fields, sort, limit, resolve }]" },
      ),
    )
    .max(LIMITS.resolveRelations),
);

function resolveDepth(list: Resolve[]): number {
  return list.reduce((deepest, entry) => Math.max(deepest, 1 + resolveDepth(entry.resolve ?? [])), 0);
}

/** A query-string value is text; this parses it as JSON, then as the given shape. */
function json<T extends z.ZodType>(shape: T, description: string) {
  return z
    .string()
    .max(LIMITS.paramLength)
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(shape)
    .describe(description);
}

/** What each parameter says in the generated spec; an endpoint's policy fills in its own allowlist. */
export type ParamDocs = Partial<Record<"search" | "sort" | "filter" | "fields" | "resolve" | "group", string>>;

const DOCS: Required<ParamDocs> = {
  search: "One search term",
  sort: 'JSON: [["field","asc"|"desc"], …]',
  filter: 'JSON: [[field, operator, value], ["or" | "and", …conditions], …]',
  fields: "JSON: [field, …] to return",
  resolve: "JSON: [[relation, { fields, sort, limit, resolve }], …]",
  group: "JSON: [field, …] to group by; rows become { key, count }",
};

/**
 * The raw parameters, each parsed; `listQuery()` in policy.ts adds the
 * allowlist on top. `docs` is appended to each parameter's description,
 * so the spec tells a client what this endpoint accepts.
 */
export function grammarFor(docs: ParamDocs = {}) {
  const say = (param: keyof ParamDocs) => (docs[param] ? `${DOCS[param]}. ${docs[param]}` : DOCS[param]);
  return z
    .object({
      // Validated and documented here; the values themselves are read from req.page, clamped by config.pagination.
      page: z.coerce.number().int().min(1).optional().describe("Page number, from 1"),
      per_page: z.coerce.number().int().min(1).optional().describe("Rows per page, clamped by config.pagination.maxLimit"),
      search: z.string().trim().min(1).max(LIMITS.searchLength).optional().describe(say("search")),
      sort: json(sort, say("sort")).optional(),
      filter: json(filter, say("filter")).optional(),
      fields: json(z.array(field).min(1).max(LIMITS.fieldsCount), say("fields")).optional(),
      resolve: json(resolveList, say("resolve")).optional(),
      group: json(z.array(field).min(1).max(LIMITS.groupKeys), say("group")).optional(),
      tree: z.enum(["true", "false"]).optional().describe("With group: nest the buckets, one level per key"),
    })
    .check((ctx) => {
      const depth = resolveDepth(ctx.value.resolve ?? []);
      if (depth > LIMITS.resolveDepth) ctx.issues.push({ code: "custom", input: ctx.value.resolve, path: ["resolve"], message: `resolve nests deeper than ${LIMITS.resolveDepth} levels` });
    })
    .transform((raw): ListQuery => ({
      ...(raw.search !== undefined && { search: raw.search }),
      sort: raw.sort ?? [],
      ...(raw.filter && { filter: raw.filter }),
      ...(raw.fields && { fields: raw.fields }),
      resolve: raw.resolve ?? [],
      group: raw.group ?? [],
      tree: raw.tree === "true",
    }));
}

/** The grammar with no endpoint's allowlist: shape only. */
export const grammar = grammarFor();
