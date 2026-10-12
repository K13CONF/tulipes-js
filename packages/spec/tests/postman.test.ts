import { expect, test } from "vitest";
import { toPostman } from "../src/postman.ts";

test("warns instead of inheriting bearer auth for a dynamic checker", async () => {
  const result = await toPostman({
    app: { name: "app" },
    folders: ["items"],
    routes: [
      {
        id: "items:web:read",
        scope: "web",
        path: "/api/catalog/items/:id",
        method: "GET",
        module: "items",
        folder: "items",
        roles: [],
        public: false,
        authorization: "dynamic",
      },
    ],
  });

  expect(result.document).toMatchObject({
    item: [
      {
        item: [
          {
            request: {
              auth: { type: "noauth" },
              url: { raw: "{{baseUrl}}/api/catalog/items/{{id}}" },
            },
          },
        ],
      },
    ],
  });

  expect(result.warnings).toContain(
    "items:web:read: custom access checker; configure authorization manually",
  );
});
