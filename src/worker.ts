/**
 * Worker entry point — consumes the shared queue and executes jobs. No HTTP
 * server. Run as a dedicated process (PM2 `bp-worker`). In dev the web process
 * can run the worker inline via `WORKER_INLINE`, so this is for staging/prod.
 */
// Side-effect: must run before any model is compiled (see register.ts)
import "@packages/mongoose/register.js"

import config from "@config/app.config.js"
import { logger } from "@config/logger.js"
import { bootstrapInfra } from "@lib/bootstrap.js"
import { startWorker } from "@lib/queue.js"
import { gracefulShutdown } from "@lib/shutdown.js"

async function start() {
    try {
        // Same infra as the web process (models, db, redis, cache, queue, mailer)
        // — job handlers (e.g. the mailer's) register during bootstrap.
        await bootstrapInfra()

        startWorker(config.app.lib.redis, config.app.lib.worker.concurrency)
        gracefulShutdown() // SIGTERM/SIGINT → drain jobs, close infra

        logger.info("Worker ready — waiting for jobs")
    } catch (error) {
        logger.error({ err: error }, "❌ Failed to start the worker")
        process.exit(1)
    }
}

start()
