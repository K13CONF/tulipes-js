/**
 * This file is the entry point
 */
import config from "@/config/app.config.js"
import { connect } from "@/lib/mongoose.js"
import { initModules } from "@/lib/modules.js"
import { createApp } from "@/lib/express.js"
import { startServer } from "@/lib/http.js"

// Connect to the database, then initialize modules (dependency + priority order).
await connect(config.app.lib.database)
await initModules(config.app.modules)

const app = createApp()
startServer(app, config.app.lib.server)
