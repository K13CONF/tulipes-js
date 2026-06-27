/**
 * This file is the entry point
 */
import "@packages/mongoose/register.js" // registers the global base plugin before any model compiles
import config from "@config/app.config.js"
import { connect, isConnected } from "@lib/mongoose.js"
import { initModules } from "@lib/modules.js"
import { initI18n } from "@lib/i18n.js"
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
    // await connect(config.app.lib.database)
    await initModules(config.app.modules)

    // Initialize i18n from each module's locale folders.
    await initI18n(config.app.modules)

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
            const numCPUs = availableParallelism()
            logger.info(`Cluster primary ${process.pid} — forking ${numCPUs} workers`)

            // Give each worker a stable slot index (0..numCPUs-1) via WORKER_INDEX,
            // and remember which slot each worker holds. When one dies we respawn
            // into the SAME slot, so its log file (app-worker-<slot>.log) is reused
            // rather than a new one being created on every restart/crash.
            const slotByWorkerId = new Map<number, number>()

            const spawnWorker = (slot: number) => {
                const worker = cluster.fork({ WORKER_INDEX: String(slot) })
                slotByWorkerId.set(worker.id, slot)
            }

            for (let slot = 0; slot < numCPUs; slot++) spawnWorker(slot)

            cluster.on("exit", (worker, code, signal) => {
                const slot = slotByWorkerId.get(worker.id) ?? 0
                slotByWorkerId.delete(worker.id)
                logger.warn(`Worker ${worker.process.pid} (slot ${slot}) exited [${signal ?? code}] — respawning`)
                spawnWorker(slot)
            })

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
