import mongoose from "mongoose";

import { baseModelPlugin } from "./plugins/base.plugin.ts";

let registered = false;

/**
 * Registers the base plugin globally so EVERY schema gets timestamps + soft
 * delete. Global plugins only affect models compiled after registration, so
 * call this before boot() — it's the first line of app.ts and worker.ts.
 *
 * An explicit function, deliberately not an import side effect: the old
 * framework's side-effect register module made correctness depend on import
 * order, which is exactly the class of bug this framework exists to kill.
 */
export function registerBasePlugins(): void {
  if (registered) return;
  registered = true;
  mongoose.plugin(baseModelPlugin);
}
