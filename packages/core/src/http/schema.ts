/**
 * What core needs from a validation schema, and nothing more.
 *
 * Deliberately structural rather than `ZodType`: core keeps no opinion
 * about which zod major an app uses — or whether it uses zod at all. Any
 * object exposing this `safeParse` shape works, which is both zod 3 and
 * zod 4, and anything else that chooses to look like them.
 *
 * `@tulipes/spec` is stricter, because turning a schema into JSON Schema
 * needs zod 4's `toJSONSchema`. Validation here does not.
 */
export interface SchemaIssue {
  /** Property path to the offending value: `["address", "city"]`. */
  path: PropertyKey[];
  message: string;
  code?: string;
}

export interface ValidatableSchema<Output = unknown> {
  safeParse(value: unknown):
    | { success: true; data: Output }
    | { success: false; error: { issues: readonly SchemaIssue[] } };
}

/** The request segments a route can describe and validate. */
export interface RouteSchemas {
  params?: ValidatableSchema;
  query?: ValidatableSchema;
  body?: ValidatableSchema;
}

/** `["address", "city"]` → `"address.city"`; an empty path means the whole segment. */
export function fieldOf(segment: keyof RouteSchemas, path: PropertyKey[]): string {
  const joined = path.map(String).join(".");
  // A body-level failure has no field of its own, so it is attributed to
  // the segment — "body" reads better to a client than null.
  return joined || segment;
}

/** `invalid_format` → `INVALID_FORMAT`. */
export function codeOfIssue(issue: SchemaIssue): string | undefined {
  return issue.code ? issue.code.toUpperCase() : undefined;
}
