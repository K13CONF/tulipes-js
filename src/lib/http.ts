import { createServer, type Server } from "node:http"
import type { Express } from "express"
import { logger } from "@config/logger.js"
import { disconnect } from "./mongoose.js"

/** Starts the HTTP server, begins listening, and wires graceful shutdown. */
export function setupHTTPServer(
    app: Express,
): Server {
    // Create the server
    const server = createServer(app)

    // Setup graceful shutdown
    setupGracefulShutdown(server)
    
    return server
}

/** On SIGTERM/SIGINT: stop accepting connections, close the DB, flush logs, exit. */
function setupGracefulShutdown(server: Server): void {
    let shuttingDown = false

    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return
        shuttingDown = true
        logger.info(`Received ${signal}, shutting down gracefully…`)

        server.close(async () => {
            try {
                await disconnect()
                logger.info("Shutdown complete")
                process.exitCode = 0
            } catch (error) {
                logger.error({ err: error }, "Error during shutdown")
                process.exitCode = 1
            } finally {
                logger.flush?.()
                process.exit()
            }
        })

        // Don't hang forever if connections refuse to drain.
        setTimeout(() => {
            logger.error("Forced shutdown after timeout")
            process.exit(1)
        }, 10_000).unref()
    }

    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
}
