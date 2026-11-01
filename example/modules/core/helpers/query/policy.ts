import { grammarFor, LIMITS, type ParamDocs, type Condition, type ListQuery, type Operator, type Primitive, type Resolve, type SortKey } from "./grammar.ts";

/**
 * The allowlist a list endpoint declares. The grammar guarantees shape;
 * the policy decides which fields, operators, relations and groupings
 * this endpoint accepts. Anything not named here is refused with the path
 * of the offending value, before the request reaches a database.
 *
 *   rai({ query: listQuery({
 *     search: ["email"],
 *     filter: { role: ["=", "in"], created_at: { type: "date", ops: [">", "<"] } },
 *     sort: ["created_at"],
 *     fields: ["email", "role", "created_at"],
 *     resolve: { sessions: { fields: ["ip", "created_at"], maxLimit: 10 } },
 *     group: ["role"],
 *   }) })
 */
export type FieldType = "string" | "number" | "boolean" | "date" | "id";

export interface FilterRule {
  type: FieldType;
  ops: readonly Operator[];
}

export interface ResolvePolicy {
  /** The only fields the related documents may expose. */
  fields: readonly string[];
  sort?: readonly string[];
  maxLimit?: number;
  resolve?: Record<string, ResolvePolicy>;
}

export interface QueryPolicy {
  /** Fields a `?search` term is matched on, or "text" to use the model's text index. */
  search?: readonly string[] | "text";
  /** A bare operator list means a string field. */
  filter?: Record<string, readonly Operator[] | FilterRule>;
  sort?: readonly string[];
  /** Fields a client may ask for; with no `?fields`, this is also the projection. */
  fields?: readonly string[];
  resolve?: Record<string, ResolvePolicy>;
  group?: readonly string[];
  /** `false` skips the count query where a total is not worth a second scan. Default true. */
  count?: boolean;
}

/** What a handler receives in `req.query`: the AST plus the policy it passed. */
export type ParsedListQuery = ListQuery & { policy: QueryPolicy };

/** A zod schema for `rai({ query })`: parses the parameters and enforces the policy. */
export function listQuery(policy: QueryPolicy) {
  return grammarFor(describe(policy))
    .check((ctx) => {
      if (ctx.issues.length) return;
      enforce(policy, ctx.value, (path, message) => {
        ctx.issues.push({ code: "custom", input: ctx.value, path, message });
      });
    })
    .transform((query): ParsedListQuery => ({ ...query, policy }));
}

/** The allowlist in words, for the spec: what a client reading the docs may send. */
function describe(policy: QueryPolicy): ParamDocs {
  const list = (names: readonly string[] | undefined) => (names?.length ? names.join(", ") : "none");
  const filters = Object.entries(policy.filter ?? {}).map(([field, rule]) => {
    const { type, ops } = Array.isArray(rule) ? { type: "string", ops: rule } : (rule as FilterRule);
    return `${field} (${type}: ${ops.join(" ")})`;
  });
  const relations = Object.entries(policy.resolve ?? {}).map(([name, rule]) => `${name} (${rule.fields.join(", ")}${rule.maxLimit ? `; at most ${rule.maxLimit}` : ""})`);
  return {
    search: policy.search === "text" ? "Matched with the model's text index" : `Matched on: ${list(policy.search as readonly string[] | undefined)}`,
    sort: `Sortable: ${list(policy.sort)}; when grouped, the group keys and count`,
    filter: `Filterable: ${filters.length ? filters.join("; ") : "none"}`,
    fields: `Allowed: ${list(policy.fields)}`,
    resolve: `Relations: ${relations.length ? relations.join("; ") : "none"}`,
    group: `Groupable: ${list(policy.group)}`,
  };
}

type Issue = (path: PropertyKey[], message: string) => void;

function enforce(policy: QueryPolicy, query: ListQuery, issue: Issue): void {
  const grouped = query.group.length > 0;

  if (query.search !== undefined && !policy.search) issue(["search"], "search is not supported here");

  if (query.filter) checkCondition(query.filter, policy.filter ?? {}, ["filter"], issue, 0);

  const sortable = grouped ? [...query.group, "count"] : (policy.sort ?? []);
  query.sort.forEach((key, index) => {
    if (!sortable.includes(key.field)) issue(["sort", index], `cannot sort by "${key.field}"`);
  });

  if (query.fields) {
    if (grouped) issue(["fields"], "fields cannot be combined with group");
    else checkFields(query.fields, policy.fields ?? [], ["fields"], issue);
  }

  if (query.resolve.length) {
    if (grouped) issue(["resolve"], "resolve cannot be combined with group");
    else checkResolve(query.resolve, policy.resolve ?? {}, ["resolve"], issue);
  }

  if (query.tree && !grouped) issue(["tree"], "tree needs group");

  query.group.forEach((field, index) => {
    if (!(policy.group ?? []).includes(field)) issue(["group", index], `cannot group by "${field}"`);
  });
}

/**
 * Paths point into the JSON the client sent: a node's items start at
 * index 1 (index 0 is "and"/"or"), except the top-level array, the
 * implicit "and", whose items start at 0. A leaf is [field, op, value].
 */
function checkCondition(node: Condition, rules: NonNullable<QueryPolicy["filter"]>, path: PropertyKey[], issue: Issue, offset: 0 | 1): void {
  if (node.kind !== "cmp") {
    node.items.forEach((item, index) => checkCondition(item, rules, [...path, index + offset], issue, 1));
    return;
  }
  // Own keys only: "constructor" or "toString" must not pass as a declared field.
  const declared = Object.hasOwn(rules, node.field) ? rules[node.field] : undefined;
  if (!declared) return issue([...path, 0], `"${node.field}" is not filterable`);
  const rule: FilterRule = Array.isArray(declared) ? { type: "string", ops: declared } : (declared as FilterRule);
  if (!rule.ops.includes(node.op)) return issue([...path, 1], `"${node.op}" is not allowed on "${node.field}"`);
  const problem = valueProblem(rule.type, node.op, node.value);
  if (problem) issue([...path, 2], `${node.field}: ${problem}`);
}

function valueProblem(type: FieldType, op: Operator, value: Primitive | Primitive[]): string | undefined {
  if (op === "exists") return typeof value === "boolean" ? undefined : "exists takes true or false";
  if (op === "in" || op === "nin") {
    if (!Array.isArray(value) || value.length === 0) return `${op} takes a non-empty list`;
    return value.every((item) => isOfType(type, item)) ? undefined : `every value must be a ${type}`;
  }
  if (Array.isArray(value)) return `${op} takes a single value`;
  if (op === "like" || op === "starts") {
    if (type !== "string") return `${op} applies to string fields only`;
    if (typeof value !== "string") return "pattern must be a string";
    return value.length <= LIMITS.patternLength ? undefined : `pattern longer than ${LIMITS.patternLength} characters`;
  }
  if (value === null) return op === "=" || op === "!=" ? undefined : `${op} does not take null`;
  return isOfType(type, value) ? undefined : `value must be a ${type}`;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function isOfType(type: FieldType, value: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "date": return (typeof value === "string" || typeof value === "number") && !Number.isNaN(new Date(value).getTime());
    case "id": return typeof value === "string" && OBJECT_ID.test(value);
  }
}

function checkFields(fields: readonly string[], allowed: readonly string[], path: PropertyKey[], issue: Issue): void {
  fields.forEach((field, index) => {
    if (!allowed.includes(field)) issue([...path, index], `"${field}" is not a field of this endpoint`);
  });
}

function checkSort(sort: readonly SortKey[], allowed: readonly string[], path: PropertyKey[], issue: Issue): void {
  sort.forEach((key, index) => {
    if (!allowed.includes(key.field)) issue([...path, index], `cannot sort by "${key.field}"`);
  });
}

/** Option issues sit under [i, 1, option]: a relation given as a bare name has no options to be wrong. */
function checkResolve(list: readonly Resolve[], policies: Record<string, ResolvePolicy>, path: PropertyKey[], issue: Issue): void {
  list.forEach((entry, index) => {
    const declared = Object.hasOwn(policies, entry.relation) ? policies[entry.relation] : undefined;
    if (!declared) return issue([...path, index], `"${entry.relation}" cannot be resolved here`);
    const options = [...path, index, 1];
    if (entry.fields) checkFields(entry.fields, declared.fields, [...options, "fields"], issue);
    if (entry.sort) checkSort(entry.sort, declared.sort ?? [], [...options, "sort"], issue);
    if (entry.limit !== undefined && declared.maxLimit !== undefined && entry.limit > declared.maxLimit) {
      issue([...options, "limit"], `${entry.relation} resolves at most ${declared.maxLimit}`);
    }
    if (entry.resolve) checkResolve(entry.resolve, declared.resolve ?? {}, [...options, "resolve"], issue);
  });
}
