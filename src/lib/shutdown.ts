import { logger } from "@config/logger.js"
import { closeQueue } from "./queue.js"
import { closeMailer } from "./mailer.js"
import { disconnectRedis } from "./redis.js"
import { disconnect } from "./mongoose.js"

/** Forced-exit deadline if cleanup hangs. */
const SHUTDOWN_TIMEOUT_MS = 10_000

/** Closes infra clients in dependency order (jobs first, then connections). */
export async function closeInfra(): Promise<void> {
    await closeQueue()
    closeMailer()
    await disconnectRedis()
    await disconnect()
}

/**
 * Installs SIGTERM/SIGINT handlers that drain and exit cleanly — shared by the
 * web (`http.ts`) and worker (`worker.ts`) entry points. `before` runs first
 * (e.g. the web server stops accepting connections) and is awaited before infra
 * is closed. Idempotent; force-exits after a timeout if cleanup stalls.
 */
export function gracefulShutdown(before?: () => Promise<void> | void): void {
    let shuttingDown = false

    const handle = (signal: NodeJS.Signals) => {
        if (shuttingDown) return
        shuttingDown = true
        logger.info(`Received ${signal}, shutting down gracefully…`)

        void (async () => {
            try {
                await before?.()
                await closeInfra()
                logger.info("Shutdown complete")
                process.exitCode = 0
            } catch (error) {
                logger.error({ err: error }, "Error during shutdown")
                process.exitCode = 1
            } finally {
                logger.flush?.()
                process.exit()
            }
        })()

        // Don't hang forever if something refuses to close.
        setTimeout(() => {
            logger.error("Forced shutdown after timeout")
            process.exit(1)
        }, SHUTDOWN_TIMEOUT_MS).unref()
    }

    process.on("SIGTERM", handle)
    process.on("SIGINT", handle)
}
