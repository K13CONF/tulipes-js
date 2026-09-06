import type { SpecRoute, SpecSource } from "./extract.js";
import { pathParams, toPostmanPath } from "./extract.js";
import { exampleFor, toJsonSchema, type JsonSchema } from "./json-schema.js";
import type { GeneratedDocument } from "./openapi.js";

/**
 * Postman Collection v2.1.
 *
 * This exists rather than telling people to import the OpenAPI document
 * because a collection can carry what a spec cannot: folders per module,
 * a `{{baseUrl}}` and `{{accessToken}}` wired through every request, and a
 * login request that captures its own token so the rest of the collection
 * is authenticated after one click.
 */
export interface PostmanOptions {
  /** Default value for the collection's `baseUrl` variable. */
  baseUrl?: string;
  name?: string;
  /**
   * RAI id of the request that returns a token pair. Its response is
   * captured into `{{accessToken}}`, so signing in once authenticates the
   * whole collection. Defaults to "auth:login" when the app declares it.
   */
  loginRouteId?: string;
}

export async function toPostman(
  source: SpecSource,
  options: PostmanOptions = {},
): Promise<GeneratedDocument> {
  const warnings: string[] = [];
  const loginId = resolveLoginId(source, options.loginRouteId);

  // One folder per `folder` value — the module name unless a route said
  // otherwise — so the collection mirrors how the app is organised.
  const folders = await Promise.all(
    source.folders.map(async (folder) => ({
      name: folder,
      item: await Promise.all(
        source.routes
          .filter((route) => route.folder === folder)
          .map((route) => request(route, route.id === loginId, warnings)),
      ),
    })),
  );

  return {
    document: {
      info: {
        name: options.name ?? source.app.name,
        description:
          "Generated from the app's declared routes. Sign in with the auth " +
          "request and every other request is authenticated automatically.",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: folders,
      // Collection-level bearer auth, inherited by every request that does
      // not override it — which is why public requests set auth: noauth.
      auth: {
        type: "bearer",
        bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
      },
      variable: [
        { key: "baseUrl", value: options.baseUrl ?? "http://localhost:3000", type: "string" },
        { key: "accessToken", value: "", type: "string" },
        { key: "refreshToken", value: "", type: "string" },
      ],
    },
    warnings,
  };
}

/** Only use a login capture if the app actually declares that route. */
function resolveLoginId(source: SpecSource, override: string | undefined): string | undefined {
  const candidate = override ?? "auth:login";
  return source.routes.some((route) => route.id === candidate) ? candidate : undefined;
}

async function request(
  route: SpecRoute,
  isLogin: boolean,
  warnings: string[],
): Promise<Record<string, unknown>> {
  const [query, body, params] = await Promise.all([
    toJsonSchema(route.query, `${route.id} query`),
    toJsonSchema(route.body, `${route.id} body`),
    toJsonSchema(route.params, `${route.id} params`),
  ]);
  [query, body, params].forEach((r) => r.warning && warnings.push(r.warning));

  const path = toPostmanPath(route.path).replace(/^\//, "").split("/");

  return {
    name: route.name ?? route.id,
    request: {
      method: route.method,
      ...(route.description && { description: route.description }),
      header: [
        ...(body.schema ? [{ key: "Content-Type", value: "application/json" }] : []),
        // Present but disabled: a reviewer can flip it on to check a
        // locale without reading the i18n documentation first.
        { key: "Accept-Language", value: "en", disabled: true },
      ],
      url: {
        raw: `{{baseUrl}}/${path.join("/")}`,
        host: ["{{baseUrl}}"],
        path,
        ...(queryItems(query.schema).length > 0 && { query: queryItems(query.schema) }),
        ...(pathParams(route.path).length > 0 && {
          variable: pathVariables(route, params.schema),
        }),
      },
      ...(body.schema && {
        body: {
          mode: "raw",
          raw: JSON.stringify(exampleFor(body.schema), null, 2),
          options: { raw: { language: "json" } },
        },
      }),
      // A public route must not send the collection's bearer token: it
      // would mask the very thing a reviewer is checking.
      ...(route.public && { auth: { type: "noauth" } }),
    },
    event: isLogin ? [captureTokens()] : [],
  };
}

/** Query parameters are disabled by default, so a request runs as-is. */
function queryItems(query: JsonSchema | undefined): unknown[] {
  if (!query?.properties) return [];
  const required = new Set((query.required as string[] | undefined) ?? []);

  return Object.entries(query.properties as Record<string, JsonSchema>).map(([key, schema]) => ({
    key,
    value: String(exampleFor(schema) ?? ""),
    disabled: !required.has(key),
    ...(typeof schema.description === "string" && { description: schema.description }),
  }));
}

function pathVariables(route: SpecRoute, params: JsonSchema | undefined): unknown[] {
  const properties = (params?.properties ?? {}) as Record<string, JsonSchema>;
  return pathParams(route.path).map((key) => ({
    key,
    value: String(exampleFor(properties[key]) ?? ""),
  }));
}

/**
 * Captures the token pair out of the envelope. Written against
 * `data.access_token`, which is the framework's shape — an app that
 * renames them adjusts this one script rather than every request.
 */
function captureTokens(): Record<string, unknown> {
  return {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const body = pm.response.json();",
        "if (body.success && body.data) {",
        "  if (body.data.access_token) {",
        "    pm.collectionVariables.set('accessToken', body.data.access_token);",
        "  }",
        "  if (body.data.refresh_token) {",
        "    pm.collectionVariables.set('refreshToken', body.data.refresh_token);",
        "  }",
        "}",
        "pm.test('enveloped response', () => {",
        "  pm.expect(body).to.have.property('success');",
        "  pm.expect(body).to.have.property('data');",
        "  pm.expect(body).to.have.property('errors');",
        "  pm.expect(body).to.have.property('meta');",
        "});",
      ],
    },
  };
}
