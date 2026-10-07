/**
 * Example maintenance script. Run it with:
 *
 *   pnpm script scripts/list-users.ts
 *
 * Script mode runs every phase the backend runs — environment, modules,
 * config, ACL, database, models, queue producers — and then starts nothing.
 * So a script gets exactly what a route handler gets, minus the server.
 *
 * The one thing to always copy from this file is the try/finally: the mongo
 * and redis connections hold the event loop open, so a script that skips
 * shutdown() prints its output and then hangs forever.
 */
import { join } from "node:path";

import { boot } from "@tulipes/core/boot";

const handle = await boot({ rootDir: join(import.meta.dirname, ".."), mode: "script" });

try {
  const { models, config } = handle.ctx;

  const users = await models!
    .get("User")
    .find()
    .select("email role -_id")
    .limit(Number(config.pagination?.maxLimit ?? 100))
    .lean();

  console.log(`${config.app?.name} — ${users.length} user(s)\n`);
  console.table(users);
} finally {
  await handle.shutdown();
}
