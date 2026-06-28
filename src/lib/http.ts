import { createServer, type Server } from "node:http"
import type { Express } from "express"
import { gracefulShutdown } from "./shutdown.js"

/** Starts the HTTP server, begins listening, and wires graceful shutdown. */
export function setupHTTPServer(app: Express): Server {
    const server = createServer(app)

    // Slowloris / idle-socket hardening: cap how long a single connection can tie
    // up resources. Generous for normal clients; `headersTimeout` must stay above
    // `keepAliveTimeout`, and `requestTimeout` bounds the whole request.
    server.keepAliveTimeout = 5_000 // idle keep-alive socket lifetime
    server.headersTimeout = 15_000 // max time to receive the full request headers
    server.requestTimeout = 30_000 // max time to receive the full request

    // On SIGTERM/SIGINT: stop accepting connections, then close infra clients.
    gracefulShutdown(
        () =>
            new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()))
            }),
    )

    return server
}
