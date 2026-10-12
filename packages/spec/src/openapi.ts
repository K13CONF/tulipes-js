import type { SpecSource, SpecRoute } from "./extract.ts";
import { pathParams, toOpenApiPath } from "./extract.ts";
import { toJsonSchema, type JsonSchema } from "./json-schema.ts";

/**
 * OpenAPI 3.1 — chosen over 3.0 because its schema dialect *is* JSON
 * Schema 2020-12, which is exactly what zod emits. On 3.0 every schema
 * would need lossy rewriting (nullable, exclusiveMinimum, examples), and
 * a document that quietly misdescribes a type is worse than none.
 */
export interface OpenApiOptions {
  /** Server URLs the document advertises. */
  servers?: string[];
  title?: string;
  version?: string;
}

export interface GeneratedDocument {
  document: Record<string, unknown>;
  warnings: string[];
}

export async function toOpenApi(
  source: SpecSource,
  options: OpenApiOptions = {},
): Promise<GeneratedDocument> {
  const warnings: string[] = [];
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of source.routes) {
    const path = toOpenApiPath(route.path);
    paths[path] ??= {};
    paths[path]![route.method.toLowerCase()] = await operation(route, warnings);
  }

  return {
    document: {
      openapi: "3.1.0",
      info: {
        title: options.title ?? source.app.name,
        version: options.version ?? source.app.version ?? "0.0.0",
      },
      ...(options.servers?.length && {
        servers: options.servers.map((url) => ({ url })),
      }),
      tags: source.folders.map((name) => ({ name })),
      // Who may call what is policy a reader of the document needs: the
      // roles the app defines, with their descriptions, and the scopes
      // (client surfaces) the described routes belong to.
      "x-tulipes-roles": (source.roles ?? []).map(({ name, description, extras }) => ({
        name,
        ...(description !== undefined && { description }),
        ...extras,
      })),
      "x-tulipes-scopes": source.scopes ?? [],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
        schemas: { Envelope: ENVELOPE_SCHEMA, ApiError: API_ERROR_SCHEMA },
      },
    },
    warnings,
  };
}

async function operation(route: SpecRoute, warnings: string[]): Promise<Record<string, unknown>> {
  if (route.authorization === "dynamic") {
    warnings.push(`${route.id}: custom access checker; authorization cannot be described statically`);
  }
  const collect = (warning?: string): void => {
    if (warning) warnings.push(warning);
  };

  const [params, query, body, returns] = await Promise.all([
    toJsonSchema(route.params, `${route.id} params`),
    toJsonSchema(route.query, `${route.id} query`),
    toJsonSchema(route.body, `${route.id} body`),
    toJsonSchema(route.returns, `${route.id} returns`),
  ]);
  [params, query, body, returns].forEach((result) => collect(result.warning));

  const parameters = [
    ...pathParameters(route, params.schema),
    ...queryParameters(query.schema),
  ];

  return {
    operationId: route.id,
    tags: [route.folder],
    ...(route.name && { summary: route.name }),
    ...(route.description && { description: route.description }),
    // The permission is the RAI id, and the roles holding it are policy a
    // reader of the document genuinely needs.
    "x-tulipes-permission": route.id,
    "x-tulipes-scope": route.scope,
    "x-tulipes-roles": route.roles,
    "x-tulipes-authorization": route.authorization ?? "acl",
    ...(parameters.length > 0 && { parameters }),
    ...(body.schema && {
      requestBody: {
        required: true,
        content: { "application/json": { schema: body.schema } },
      },
    }),
    // A public route needs no credential; every other one does. An empty
    // array on `security` is OpenAPI's way of saying "optional".
    ...(route.authorization !== "dynamic" && { security: route.public ? [] : [{ bearerAuth: [] }] }),
    responses: responses(route, returns.schema),
  };
}

/**
 * Path parameters are always required — a missing one does not match the
 * route at all — and their shapes come from the `params` schema when the
 * route declares one.
 */
function pathParameters(route: SpecRoute, params: JsonSchema | undefined): unknown[] {
  const properties = (params?.properties ?? {}) as Record<string, JsonSchema>;

  return pathParams(route.path).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: properties[name] ?? { type: "string" },
  }));
}

function queryParameters(query: JsonSchema | undefined): unknown[] {
  if (!query?.properties) return [];
  const required = new Set((query.required as string[] | undefined) ?? []);

  return Object.entries(query.properties as Record<string, JsonSchema>).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema,
  }));
}

/**
 * Every response is the envelope, so the shell is described once and only
 * `data` varies. A reader learns the contract from any single operation.
 */
function responses(route: SpecRoute, returns: JsonSchema | undefined): Record<string, unknown> {
  const success = {
    description: "Success",
    content: {
      "application/json": {
        schema: {
          allOf: [
            { $ref: "#/components/schemas/Envelope" },
            {
              type: "object",
              properties: {
                success: { const: true },
                data: returns ?? {},
              },
            },
          ],
        },
      },
    },
  };

  const failure = (description: string): Record<string, unknown> => ({
    description,
    content: {
      "application/json": {
        schema: {
          allOf: [
            { $ref: "#/components/schemas/Envelope" },
            { type: "object", properties: { success: { const: false }, data: { const: null } } },
          ],
        },
      },
    },
  });

  return {
    [String(route.status ?? 200)]: route.status === 204 ? { description: "Success" } : success,
    ...(hasValidation(route) && { "422": failure("Validation failed") }),
    ...(!route.public && {
      "401": failure("Authentication required"),
      "403": failure("Authenticated, but not permitted"),
    }),
  };
}

const hasValidation = (route: SpecRoute): boolean =>
  Boolean(route.params ?? route.query ?? route.body);

const API_ERROR_SCHEMA = {
  type: "object",
  required: ["field", "message", "code"],
  properties: {
    field: { type: ["string", "null"], description: "The offending input, when there is one" },
    message: { type: "string", description: "Translated into the caller's locale" },
    code: { type: "string", description: "Stable and never translated — branch on this" },
  },
} as const;

const ENVELOPE_SCHEMA = {
  type: "object",
  required: ["success", "data", "errors", "meta"],
  properties: {
    success: { type: "boolean" },
    data: { description: "The payload on success; null on failure" },
    errors: { type: "array", items: { $ref: "#/components/schemas/ApiError" } },
    meta: {
      type: "object",
      properties: {
        action: { type: "string", description: "What the client should do next" },
        page: { type: "integer" },
        per_page: { type: "integer" },
        total_pages: { type: "integer" },
        total_items: { type: "integer" },
      },
    },
  },
} as const;
