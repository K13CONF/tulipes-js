import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

import { registerBasePlugins } from "./helpers/mongoose/index.ts";

/**
 * Declaration time (boot phase 4) is before models compile (phase 5), which
 * is exactly when a global mongoose plugin has to exist: registering here
 * makes the base plugins apply in EVERY mode — backend, worker and script
 * alike — so a script can never read rows the API considers deleted.
 */
registerBasePlugins();

/**
 * The sys core module's own settings. The environment keeps only what boot
 * needs before the store answers (the port, the connection strings, the log
 * destinations) and the secrets; everything else is a setting like this one.
 */
export default defineConfig({
  schema: z.object({
    publicDomain: z.string().min(1).default("localhost")
      .describe("Public hostname this API is served from; \"localhost\" means not deployed. The nginx deploy script and the generated API documents read it"),
  }),
});
