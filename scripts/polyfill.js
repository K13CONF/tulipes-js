/**
 * Use this file to polyfill the config and db connection
 * if you need to execute a script.
 */
import config, { moduleRegistry } from "#config/app.config.js"
import { connect } from '#lib/mongoose.js'
import { loadModuleModels } from "#lib/modules.js";

// Register every module's Mongoose model (side-effect imports) before use.
await loadModuleModels(moduleRegistry)

// connect the database
await connect(config.app.lib.database)