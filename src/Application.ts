/**
 * This file is the entry point
 */
import config from "@config/app.config.js"
import { connect, isConnected } from "@lib/mongoose.js"
import { initModules } from "@lib/modules.js"
import { createApp } from "@lib/express.js"
import { setupHTTPServer } from "@lib/http.js"
import { buildStartupInfo, printStartupBanner, type StartupInfo } from "@helpers/startup-banner.js"
import { logger } from "./config/logger.js";

import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import process from 'node:process';
import { boolean } from "zod";

const bootStartedAt = Date.now()

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



/** Announce the running server: a colored banner for humans + a structured line for the file. */
function announceReady(): void {
    const info = buildStartupInfo(bootStartedAt, config.app.lib, isConnected)
    printStartupBanner(info)
}

/**
 * Start the server
 */
async function start() {
    try {
        // Get the server configuration
        // to decide whether to run an http or https server
        const { port, host, https, clusterModeEnabled } = config.app.lib.server


        if (clusterModeEnabled && cluster.isPrimary) {
            logger.info(`Running in cluster mode: Primary process ${process.pid}`)

            // 1. Get the total number of available CPU cores
            const numCPUs = availableParallelism();

            // 2. Fork a worker process for each CPU core
            for (let i = 0; i < numCPUs; i++) {
                cluster.fork()
            }

            // 3. Listen for dying workers and replace them immediately
            cluster.on('exit', (worker, code, signal) => {
                console.log(`Worker ${worker.process.pid} died. Spawning a new one...`);
                cluster.fork();
            });

        } else {

            const app = await init()


            if (https.isEnabled) {
                // TODO: https server configuration will be added later
                logger.warn("HTTPS is enabled but not yet implemented — no server started")
            } else {
                const server = setupHTTPServer(app)
                server.listen(port, host, announceReady)
            }
        }
    } catch (error) {
        logger.error({ err: error }, "❌ Failed to start the server")
        process.exit(1)
    }
}

start()
