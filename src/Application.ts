/**
 * This file is the entry point
 */
import config from "@config/app.config.js"
import { connect } from "@lib/mongoose.js"
import { initModules } from "@lib/modules.js"
import { createApp } from "@lib/express.js"
import { setupHTTPServer } from "@lib/http.js"
import { logger } from "./config/logger.js";


/**
 * Initialise all the libs
 */
async function init() {
    // Connect to the database, then initialize modules (dependency + priority order).
    await connect(config.app.lib.database)
    await initModules(config.app.modules)

    const app = createApp()

    return app
}

/**
 * Start the server
 */
async function start() {
    init().then(app => {
        // Get the server configuration
        // to decide wether to run in http or https server
        const { port, host, https } = config.app.lib.server;

        if (https.isEnabled) {
            // TODO: https server configuration will be added later
        } else {
            const server = setupHTTPServer(app)
            server.listen(port, host, () => {
                logger.info(`🚀 Server listening on http://${host}:${port}`)
            })
        }
    })
}

start()