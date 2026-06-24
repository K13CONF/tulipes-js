/**
 * Use this file to polyfill the config and db connection
 * if you need to execute a script.
 */
import config from "#config/app.config.js"
import { connect } from '#lib/mongoose.js'

// connect the database
await connect(config.app.lib.database)