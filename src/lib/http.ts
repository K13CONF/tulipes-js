import { createServer, type Server } from "node:http"
import type { Express } from "express"

/** Starts the HTTP server and begins listening on the given host/port. */
export function startServer(
    app: Express,
    options: { host: string; port: number },
): Server {
    const server = createServer(app)
    server.listen(options.port, options.host, () => {
        console.log(`🚀 Server listening on http://${options.host}:${options.port}`)
    })
    return server
}
