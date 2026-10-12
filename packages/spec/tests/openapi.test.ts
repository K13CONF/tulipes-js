import { expect, test } from "vitest";
import { toOpenApi } from "../src/openapi.ts";
import type { SpecRoute, SpecSource } from "../src/extract.ts";

function source(route: Partial<SpecRoute> = {}): SpecSource {
  return {
    app: { name: "test" },
    folders: ["items"],
    routes: [
      {
        id: "items:web:create",
        scope: "web",
        method: "POST",
        path: "/items",
        module: "items",
        folder: "items",
        public: false,
        roles: ["user"],
        ...route,
      },
    ],
  };
}

test("documents the declared success status instead of always 200", async () => {
  const result = await toOpenApi(source({ status: 201 }));

  expect(result.document).toMatchObject({
    paths: {
      "/items": {
        post: {
          responses: { "201": { description: "Success" } },
        },
      },
    },
  });

  const paths = result.document.paths as Record<
    string,
    Record<string, { responses: object }>
  >;

  expect(paths["/items"]!.post!.responses).not.toHaveProperty("200");
});

test("does not claim a bearer policy when authorization is dynamic", async () => {
  const result = await toOpenApi(
    source({ authorization: "dynamic", roles: [] }),
  );

  expect(result.document).toMatchObject({
    paths: {
      "/items": {
        post: {
          "x-tulipes-authorization": "dynamic",
        },
      },
    },
  });

  const paths = result.document.paths as Record<string, Record<string, object>>;

  expect(paths["/items"]!.post).not.toHaveProperty("security");

  expect(result.warnings).toContain(
    "items:web:create: custom access checker; authorization cannot be described statically",
  );
});

test("a declared 204 response has no JSON response body", async () => {
  const result = await toOpenApi(source({ status: 204 }));

  const paths = result.document.paths as Record<
    string,
    Record<string, { responses: Record<string, object> }>
  >;

  expect(paths["/items"]!.post!.responses["204"]).toEqual({
    description: "Success",
  });
});
