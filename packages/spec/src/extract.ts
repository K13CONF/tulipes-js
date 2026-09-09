import type { Ctx } from "@tulipes/core/boot";
import type { RouteRecord, ValidatableSchema } from "@tulipes/core/http";

/**
 * Everything a generated document needs about one endpoint, gathered from
 * the running app rather than from parsing source — so a spec cannot
 * describe a route that is not actually mounted, nor miss one that is.
 */
export interface SpecRoute {
  status?: number;
  /** Static ACL grants cannot describe a custom checker. */
  authorization?: "acl" | "dynamic";
  id: string;
  method: string;
  /** As express declared it: `/users/:email`. */
  path: string;
  module: string;
  /** Postman folder / OpenAPI tag. `info.folder`, else the module. */
  folder: string;
  name?: string;
  description?: string;
  params?: ValidatableSchema;
  query?: ValidatableSchema;
  body?: ValidatableSchema;
  returns?: ValidatableSchema;
  /** Roles that hold this permission. Empty means nobody can reach it. */
  roles: string[];
  /** Whether an unauthenticated caller can reach it. */
  public: boolean;
}

export interface SpecSource {
  app: { name: string; version?: string };
  routes: SpecRoute[];
  folders: string[];
}

/** The role an unauthenticated caller has — see the framework's guest model. */
const GUEST = "guest";

export function extract(ctx: Pick<Ctx, "config" | "routes" | "acl">): SpecSource {
  const grants = ctx.acl?.describe() ?? [];

  // A grant reaches a permission directly, through its namespace wildcard,
  // or through "*" — the same three ways the ACL itself resolves one, so
  // the document can never disagree with what the app enforces.
  const rolesFor = (id: string): string[] => {
    const namespace = `${id.split(":")[0]}:*`;
    const roles = grants
      .filter(({ resource }) => resource === id || resource === "*" || resource === namespace)
      .map(({ role }) => role);
    return [...new Set(roles)].sort();
  };

  const routes: SpecRoute[] = [...ctx.routes.all()]
    .map((record: RouteRecord): SpecRoute => {
      const { info } = record;
      const roles = ctx.routes.checker ? [] : rolesFor(info.id);

      return {
        id: info.id,
        authorization: ctx.routes.checker ? "dynamic" : "acl",
        ...(info.status !== undefined && { status: info.status }),
        method: record.method.toUpperCase(),
        path: record.path,
        module: record.module,
        folder: info.folder ?? record.module,
        ...(info.name && { name: info.name }),
        ...(info.description && { description: info.description }),
        ...(info.params && { params: info.params }),
        ...(info.query && { query: info.query }),
        ...(info.body && { body: info.body }),
        ...(info.returns && { returns: info.returns }),
        roles,
        public: roles.includes(GUEST),
      };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.path.localeCompare(b.path));

  return {
    app: {
      name: String((ctx.config.app as { name?: unknown } | undefined)?.name ?? "api"),
      ...(typeof (ctx.config.app as { version?: unknown } | undefined)?.version === "string" && {
        version: String((ctx.config.app as { version?: unknown }).version),
      }),
    },
    routes,
    folders: [...new Set(routes.map((route) => route.folder))].sort(),
  };
}

/** `/users/:email` → `/users/{email}`, which is how OpenAPI writes params. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

/** `/users/:email` → `/users/{{email}}`, Postman's variable syntax. */
export function toPostmanPath(path: string): string {
  return path.replace(/:(\w+)/g, "{{$1}}");
}

/** The `:param` names a path declares, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((match) => match[1]!);
}
