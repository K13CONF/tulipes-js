import type { Provider } from "../boot/providers.js";

/**
 * `@tulipes/core/db` moved to `@tulipes/mongoose`. What remains here is the
 * migration diagnostic: an app whose package.json still declares this
 * subpath as its models provider gets one boot error naming the fix, instead
 * of a resolution failure, and an import of `ModelDef` from here fails to
 * typecheck with "no exported member" — see MIGRATING.md.
 */
const moved: Provider<"models"> = {
  contract: 2,
  capability: "models",
  name: "core/db (moved)",
  async acquire(_ctx, report) {
    report.add({
      scope: "providers",
      message: '"@tulipes/core/db" no longer contains the Mongoose provider — install @tulipes/mongoose, declare "tulipes": { "providers": { "models": "@tulipes/mongoose" } } and import ModelDef/BootstrapFn from it',
    });
    return undefined;
  },
};

export default moved;
