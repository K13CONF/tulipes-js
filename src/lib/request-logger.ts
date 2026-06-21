import { pinoHttp } from "pino-http"
import { logger } from "@config/logger.js"

/**
 * Per-request logging middleware (pino-http). Attaches a child logger with a
 * correlation `reqId` to `req.log`, and auto-logs each request/response at a
 * level derived from the status code.
 */
export const requestLogger = pinoHttp({
    logger,
    customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return "error"
        if (res.statusCode >= 400) return "warn"
        return "info"
    },
})
