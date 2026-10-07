import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

import { registerBasePlugins } from "./helpers/mongoose/index.js";

/**
 * Declaration time (boot phase 4) is before models compile (phase 5), which
 * is exactly when a global mongoose plugin has to exist: registering here
 * makes the base plugins apply in EVERY mode — backend, worker and script
 * alike — so a script can never read rows the API considers deleted.
 */
registerBasePlugins();

/** The sys core module has no settings of its own; its helpers read env and `config.app`. */
export default defineConfig({ schema: z.object({}) });
