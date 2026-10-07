/**
 * Generates an OpenAPI document and a Postman collection from a Tulipes
 * app's declared routes.
 *
 * The source is the RAI registry of a *booted* app, not parsed source, so
 * a generated document describes exactly what is mounted — it cannot
 * invent an endpoint or miss one. `tulipes spec` is the CLI over this.
 */
export { extract, pathParams, toOpenApiPath, toPostmanPath } from "./extract.ts";
export type { SpecRoute, SpecSource } from "./extract.ts";
export { toOpenApi } from "./openapi.ts";
export type { GeneratedDocument, OpenApiOptions } from "./openapi.ts";
export { toPostman } from "./postman.ts";
export type { PostmanOptions } from "./postman.ts";
export { toJsonSchema, exampleFor } from "./json-schema.ts";
export type { JsonSchema } from "./json-schema.ts";
