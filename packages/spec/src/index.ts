/**
 * Generates an OpenAPI document and a Postman collection from a Tulipes
 * app's declared routes.
 *
 * The source is the RAI registry of a *booted* app, not parsed source, so
 * a generated document describes exactly what is mounted — it cannot
 * invent an endpoint or miss one. `tulipes spec` is the CLI over this.
 */
export { extract, pathParams, toOpenApiPath, toPostmanPath } from "./extract.js";
export type { SpecRoute, SpecSource } from "./extract.js";
export { toOpenApi } from "./openapi.js";
export type { GeneratedDocument, OpenApiOptions } from "./openapi.js";
export { toPostman } from "./postman.js";
export type { PostmanOptions } from "./postman.js";
export { toJsonSchema, exampleFor } from "./json-schema.js";
export type { JsonSchema } from "./json-schema.js";
