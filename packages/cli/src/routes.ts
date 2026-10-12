import { inspectApp } from "./inspection.ts";

export interface RoutesOptions {
  /** Only the endpoints whose RAI id has this scope (`bo`, `web`, …). */
  scope?: string;
}

/**
 * `tulipes routes` — every endpoint the app declares, with the roles that
 * can reach it, from an inspection boot: the same route scan and ACL the
 * running app uses, with no service touched. Sorted by RAI id, so a
 * module's endpoints group together and, inside it, each scope's.
 */
export async function runRoutes(rootDir: string, options: RoutesOptions = {}): Promise<void> {
  const handle = await inspectApp(rootDir);

  try {
    const all = [...handle.ctx.routes.all()];
    const records = all
      .filter((record) => options.scope === undefined || record.info.id.split(":")[1] === options.scope)
      .sort((a, b) => a.info.id.localeCompare(b.info.id));

    if (records.length === 0) {
      if (options.scope === undefined || all.length === 0) {
        console.log("no routes declared");
      } else {
        const scopes = [...new Set(all.map((record) => record.info.id.split(":")[1]))].sort();
        console.log(`no routes in scope "${options.scope}" — the app declares: ${scopes.join(", ")}`);
      }
      return;
    }

    // The ACL answers with the same resolution it gates requests with.
    const acl = handle.ctx.acl!;
    const rolesFor = (id: string): string => {
      if (handle.ctx.routes.checker) return "dynamic (custom access checker)";
      return acl.rolesFor(id).join(", ") || "— nobody";
    };

    const width = (pick: (r: (typeof records)[number]) => string): number =>
      Math.max(...records.map((r) => pick(r).length));

    const w = {
      method: width((r) => r.method),
      id: width((r) => r.info.id),
      path: width((r) => r.path),
      module: width((r) => r.module),
    };

    const scope = options.scope === undefined ? "" : ` in scope "${options.scope}"`;
    console.log(`${records.length} endpoint(s)${scope}\n`);
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
