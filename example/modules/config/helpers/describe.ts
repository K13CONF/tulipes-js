import type { Ctx } from "@tulipes/core/boot";

/**
 * Everything the framework knows about one module, for the console: the
 * manifest, the variables it declares (names, types, sources — a secret's
 * value never, any value only as what the process resolved), its settings
 * with their schema, live values and stored version, and its endpoints
 * with the roles that reach them. Nothing is invented: it all comes from
 * the booted context, so the console cannot describe an app different
 * from the one running.
 */
export function describeModule(ctx: Ctx, name: string): Record<string, unknown> | undefined {
  const manifest = ctx.modules.find((entry) => entry.name === name);
  if (!manifest) return undefined;

  const variables = ctx.Environment.store.describe()
    .filter((variable) => variable.owner === name)
    .map((variable) => ({
      name: variable.spec.name,
      type: variable.spec.type,
      description: variable.spec.description,
      group: variable.spec.group ?? null,
      required: variable.spec.required ?? false,
      enum: variable.spec.enum ?? null,
      default: variable.spec.type === "secret" ? null : (variable.spec.default ?? null),
      source: variable.source,
      is_secret: variable.isSecret,
      is_set: variable.isSet,
      // What this process resolved; a secret is never here.
      value: variable.isSecret ? null : (variable.value ?? null),
    }));

  const settings = ctx.settings.namespaces().includes(name) ? ctx.settings.describe(name) : undefined;
  const routes = ctx.routes.all()
    .filter((record) => record.module === name)
    .map((record) => ({
      id: record.info.id,
      method: record.method.toUpperCase(),
      path: record.path,
      name: record.info.name ?? null,
      // The ACL resolves who holds the id exactly as it gates the request.
      roles: ctx.routes.checker ? "dynamic" : (ctx.acl?.rolesFor(record.info.id) ?? []),
    }));

  return {
    name: manifest.name,
    tier: manifest.tier,
    priority: manifest.priority,
    depends_on: manifest.dependsOn,
    variables,
    settings: settings
      ? {
          schema: settings.schema,
          values: settings.values,
          version: settings.stored.version,
          updated_at: settings.stored.updated_at,
          updated_by: settings.stored.updated_by,
          restart_fields: settings.restart,
          pending_restart: settings.pendingRestart,
        }
      : null,
    routes,
  };
}

/**
 * Every role the app defines, with the description and extras it was
 * defined with — so the console can say who "admin" is, not just that it
 * exists — and the grants each one holds.
 */
export function describeRoles(ctx: Ctx): Record<string, unknown>[] {
  const grants = ctx.acl?.describe() ?? [];
  return (ctx.acl?.describeRoles() ?? []).map(({ name, definedBy, description, ...extras }) => ({
    name,
    description: description ?? null,
    defined_by: definedBy,
    extras,
    grants: grants.filter(({ role }) => role === name).map(({ resource }) => resource).sort(),
  }));
}
