import type { ValidatableSchema } from "@tulipes/core/http";

/**
 * Turns a schema into JSON Schema, which both emitters need.
 *
 * Zod 4 ships `toJSONSchema` natively — no converter dependency, and it
 * stays correct as zod grows. It is loaded lazily and by subpath so this
 * package works in an app on zod 3: a v3 schema simply yields no JSON
 * Schema, and the document describes the endpoint without a body shape
 * rather than failing to generate at all.
 */
type ToJSONSchema = (schema: unknown, options?: Record<string, unknown>) => JsonSchema;

export type JsonSchema = Record<string, unknown>;

let converter: ToJSONSchema | null | undefined;

async function loadConverter(): Promise<ToJSONSchema | null> {
  if (converter !== undefined) return converter;
  try {
    const zod = (await import("zod/v4")) as { toJSONSchema?: ToJSONSchema };
    converter = zod.toJSONSchema ?? null;
  } catch {
    converter = null;
  }
  return converter;
}

export interface ConvertResult {
  schema?: JsonSchema;
  /** Why a schema was declared but produced nothing, for the report. */
  warning?: string;
}

export async function toJsonSchema(
  schema: ValidatableSchema | undefined,
  label: string,
): Promise<ConvertResult> {
  if (!schema) return {};

  const convert = await loadConverter();
  if (!convert) {
    return { warning: `${label}: zod 4 not available, shape omitted` };
  }

  try {
    const json = convert(schema, {
      // A spec describes what a client sends and receives, so a schema
      // that cannot be represented should degrade to "any" rather than
      // abort the whole document.
      unrepresentable: "any",
      io: "input",
    });
    // The $schema declaration belongs to a standalone document, not to an
    // inlined sub-schema inside OpenAPI or Postman.
    delete json.$schema;
    return { schema: json };
  } catch (error) {
    return { warning: `${label}: ${(error as Error).message}` };
  }
}

/**
 * A best-effort example object, so a Postman request arrives with a body
 * worth sending rather than an empty `{}`.
 *
 * Deliberately shallow and unclever: it reads defaults, examples, enums
 * and types, and gives up on anything else. A wrong guess in a template
 * body costs nothing; a wrong guess in the schema itself would.
 */
export function exampleFor(schema: JsonSchema | undefined): unknown {
  if (!schema) return undefined;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(properties)) out[key] = exampleFor(value);
      return out;
    }
    case "array":
      return [exampleFor(schema.items as JsonSchema | undefined)].filter(
        (value) => value !== undefined,
      );
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "string":
      return placeholderFor(schema);
    default:
      return null;
  }
}

function placeholderFor(schema: JsonSchema): string {
  switch (schema.format) {
    case "email":
      return "user@example.com";
    case "uri":
    case "url":
      return "https://example.com";
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "date-time":
      return new Date(0).toISOString();
    case "date":
      return "1970-01-01";
    default:
      return "string";
  }
}
