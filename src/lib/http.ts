import { createServer, type Server } from "node:http"
import type { Express } from "express"
import { gracefulShutdown } from "./shutdown.js"

/** Starts the HTTP server, begins listening, and wires graceful shutdown. */
export function setupHTTPServer(app: Express): Server {
    const server = createServer(app)

    // On SIGTERM/SIGINT: stop accepting connections, then close infra clients.
    gracefulShutdown(
        () =>
            new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()))
            }),
    )

    return server
}
