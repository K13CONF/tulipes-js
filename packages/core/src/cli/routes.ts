import { boot } from "../boot/boot.js";

/**
 * `tulipes routes` — every endpoint the app declares, with the roles that
 * can reach it.
 *
 * Boots in script mode, which is the point: the list comes from the
 * running app rather than from parsing source, so it cannot disagree with
 * what actually serves traffic. It is also the substrate a spec generator
 * plugs into later.
 */
export async function runRoutes(rootDir: string): Promise<void> {
  // Routes are mounted by the backend branch, so this needs that branch —
  // but it must not listen. handleSignals stays off; we shut down below.
  const handle = await boot({
    rootDir,
    mode: "backend",
    handleSignals: false,
    // No port: this must work while the app is already running.
    listen: false,
  });

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
