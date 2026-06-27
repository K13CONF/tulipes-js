import mongoose from "mongoose"
import { baseModelPlugin } from "./plugins/base.plugin.js"

/**
 * Registers the base plugin globally so EVERY schema gets timestamps + soft
 * delete. Global plugins only apply to schemas compiled *after* registration,
 * so this module must be imported before any model is defined — it's the first
 * import in `Application.ts`.
 */
mongoose.plugin(baseModelPlugin)
