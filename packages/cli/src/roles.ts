import { inspectApp } from "./inspection.ts";

export interface RolesOptions {
  /** Describe only this role. */
  role?: string;
}

/**
 * `tulipes roles` — every role the app defines: its description, the
 * extra properties it was defined with, the module that defined it and
 * the grants it holds, from the same inspection boot as `tulipes routes`.
 *
 *   admin  Runs the back office  (auth)
 *     level=2
 *     auth:*        granted by auth
 *     users:*       granted by auth
 */
export async function runRoles(rootDir: string, options: RolesOptions = {}): Promise<void> {
  const handle = await inspectApp(rootDir);

  try {
    const acl = handle.ctx.acl!;
    const all = acl.describeRoles();

    if (options.role !== undefined && !acl.hasRole(options.role)) {
      console.error(`unknown role "${options.role}" — the app defines: ${all.map(({ name }) => name).join(", ") || "none"}`);
      process.exitCode = 2;
      return;
    }

    const roles = options.role === undefined ? all : all.filter(({ name }) => name === options.role);
    if (roles.length === 0) {
      console.log("no roles defined");
      return;
    }

    const grants = acl.describe();
    const width = Math.max(...roles.map(({ name }) => name.length));

    console.log(`${roles.length} role(s)\n`);
    for (const { name, definedBy, description, ...extras } of roles) {
      console.log(`${name.padEnd(width)}  ${description ?? "—"}  (${definedBy})`);

      const extraLine = Object.entries(extras)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("  ");
      if (extraLine) console.log(`  ${extraLine}`);

      const held = grants.filter(({ role }) => role === name).sort((a, b) => a.resource.localeCompare(b.resource));
      if (held.length === 0) {
        console.log("  no grants");
      } else {
        const resourceWidth = Math.max(...held.map(({ resource }) => resource.length));
        for (const { resource, grantedBy } of held) {
          console.log(`  ${resource.padEnd(resourceWidth)}  granted by ${grantedBy}`);
        }
      }
      console.log("");
    }
  } finally {
    await handle.shutdown();
  }
}
