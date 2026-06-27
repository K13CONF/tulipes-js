/**
 * Web entry point — the HTTP server (a queue *producer*). Clustering is owned by
 * PM2 (the app no longer forks via node:cluster). The queue worker runs here
 * only when `WORKER_INLINE` is set (dev convenience); in staging/prod a
 * dedicated worker process (`worker.ts`, run via PM2) consumes jobs.
 */
// Side-effect: must run before any model is compiled (see register.ts)
import "@packages/mongoose/register.js"

// Config
import config from "@config/app.config.js"
import { logger } from "@config/logger.js"

// Libs
import { isConnected } from "@lib/mongoose.js"
import { bootstrapInfra } from "@lib/bootstrap.js"
import { startWorker } from "@lib/queue.js"
import { initModules } from "@lib/modules.js"
import { initI18n } from "@lib/i18n.js"
import { createApp } from "@lib/express.js"
import { setupHTTPServer } from "@lib/http.js"

// Helpers
import { buildStartupInfo, printStartupBanner } from "@helpers/startup-banner.js"

const bootStartedAt = Date.now()

/**
 * Initialise all the libs.
 */
async function init() {
    // Shared infra: models, MongoDB, Redis, cache, queue (producer), mailer.
    await bootstrapInfra()

    // Run the worker in-process only in dev (WORKER_INLINE); staging/prod run a
    // dedicated worker process instead.
    if (config.app.lib.worker.inline) {
        startWorker(config.app.lib.redis, config.app.lib.worker.concurrency)
    }

    // Initialize modules (dependency + priority order), then i18n namespaces.
    await initModules(config.app.modules)
    await initI18n(config.app.modules)

    return createApp()
}

/** Announce the running server: a colored banner for humans + a structured line for the file. */
function announceReady(): void {
    const info = buildStartupInfo(bootStartedAt, config.app.lib, isConnected)
    printStartupBanner(info)
}

/**
 * Start the server.
 */
async function start() {
    try {
        const { port, host, https } = config.app.lib.server
        const app = await init()

        if (https.isEnabled) {
            // TODO: https server configuration will be added later
            logger.warn("HTTPS is enabled but not yet implemented — no server started")
            return
        }

        const server = setupHTTPServer(app)
        server.listen(port, host, announceReady)
    } catch (error) {
        logger.error({ err: error }, "❌ Failed to start the server")
        process.exit(1)
    }
}

start()
