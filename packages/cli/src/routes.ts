import { inspectApp } from "./inspection.ts";

/**
 * `tulipes routes` — every endpoint the app declares, with the roles that
 * can reach it, from an inspection boot: the same route scan and ACL the
 * running app uses, with no service touched.
 */
export async function runRoutes(rootDir: string): Promise<void> {
  const handle = await inspectApp(rootDir);

  try {
    const records = [...handle.ctx.routes.all()].sort((a, b) =>
      a.info.id.localeCompare(b.info.id),
    );

    if (records.length === 0) {
      console.log("no routes declared");
      return;
    }

    const grants = handle.ctx.acl!.describe();
    const rolesFor = (id: string): string => {
      if (handle.ctx.routes.checker) return "dynamic (custom access checker)";
      const roles = grants
        .filter(({ resource }) => resource === id || resource === "*" || resource === `${id.split(":")[0]}:*`)
        .map(({ role }) => role);
      return [...new Set(roles)].sort().join(", ") || "— nobody";
    };

    const width = (pick: (r: (typeof records)[number]) => string): number =>
      Math.max(...records.map((r) => pick(r).length));

    const w = {
      method: width((r) => r.method),
      id: width((r) => r.info.id),
      path: width((r) => r.path),
      module: width((r) => r.module),
    };

    console.log(`${records.length} endpoint(s)\n`);
    for (const record of records) {
      console.log(
        [
          record.method.padEnd(w.method),
          record.info.id.padEnd(w.id),
          record.path.padEnd(w.path),
          record.module.padEnd(w.module),
          rolesFor(record.info.id),
        ].join("  "),
      );
      if (record.info.name || record.info.description) {
        const label = [record.info.name, record.info.description]
          .filter(Boolean)
          .join(" — ");
        console.log(" ".repeat(w.method + 2) + label);
      }
    }
  } finally {
    await handle.shutdown();
  }
}
