import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import pino, { type Logger, type LoggerOptions, type StreamEntry } from "pino"
import { createStream } from "rotating-file-stream"
import env from "./env.js"

/**
 * Application logger (Pino) and its configuration — owned entirely by the config
 * layer.
 *
 * - Console: colored, human-friendly when `pretty` (non-production); raw JSON to
 *   stdout otherwise.
 * - File: newline-delimited JSON, rotated daily or at 20MB, gzipped, keeping 14
 *   files in `LOG_DIR` (default ./logs) — grep/jq/Loki/ELK queryable.
 * - Secrets are redacted so they never reach a transport.
 */

const isProduction = env.NODE_ENV === "production"

// ── Configuration (derived from env) ───────────────────────────────────────
const level = env.LOG_LEVEL ?? (isProduction ? "info" : "debug")
const pretty = !isProduction
const toFile = env.LOG_TO_FILE ? env.LOG_TO_FILE === "true" : true
const dir = resolve(env.LOG_DIR) // absolute; LOG_DIR is relative to the cwd
const rotation = { interval: "1d", size: "20M", compress: "gzip", maxFiles: 14 } as const

/**
 * In cluster mode every worker runs this module in its own process, and
 * `rotating-file-stream` assumes a single writer per file. To avoid two workers
 * racing on one file, each writes its own — keyed by the slot index the primary
 * assigns via `WORKER_INDEX` (see `Application.ts`). That slot is reused when a
 * worker respawns, so the set stays `app-worker-0.log … app-worker-<n-1>.log`
 * instead of growing on every restart. Outside cluster mode → plain `app.log`.
 */
const workerIndex = env.CLUSTER_MODE_ENABLED === "true" ? (process.env.WORKER_INDEX ?? "0") : null
const baseName = workerIndex === null ? "app" : `app-worker-${workerIndex}`

/** `yyyy-mm-dd`, used in rotated file names. */
function dateStamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Live file is `<base>.log`; rotations append the date (and `.N` for same-day rolls). */
function logFileName(time: number | Date | null, index?: number): string {
    if (!time) return `${baseName}.log`
    const date = time instanceof Date ? time : new Date(time)
    const sameDayRoll = index && index > 1 ? `.${index}` : ""
    return `${baseName}-${dateStamp(date)}${sameDayRoll}.log`
}

const options: LoggerOptions = {
    level,
    // ISO timestamps and string level labels keep the JSON files clear.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => ({ level: label }),
    },
    // Never let secrets reach the console or disk.
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "password",
            "*.password",
            "secret",
            "*.secret",
            "token",
            "*.token",
        ],
        censor: "[REDACTED]",
    },
}

const streams: StreamEntry[] = []

if (!pretty) {
    streams.push({ level, stream: process.stdout })
} else {
    // pino-pretty is a dev-only dependency; load it lazily so production never
    // needs it installed.
    const { default: pinoPretty } = await import("pino-pretty")
    streams.push({
        level,
        stream: pinoPretty({
            colorize: true,
            translateTime: "SYS:standard",
            // Hide the verbose request objects from the console; the file keeps
            // them in full. Request logs are summarized by `messageFormat` below.
            ignore: "pid,hostname,req,res,responseTime",
            messageFormat: (log, messageKey) => {
                const req = log.req as { method?: string; url?: string; id?: number } | undefined
                const res = log.res as { statusCode?: number } | undefined
                const msg = (log[messageKey] as string | undefined) ?? ""

                // Completed request -> one compact line.
                if (req?.method && res?.statusCode !== undefined) {
                    const ms = typeof log.responseTime === "number" ? ` ${Math.round(log.responseTime)}ms` : ""
                    const id = req.id !== undefined ? ` #${req.id}` : ""
                    return `${req.method} ${req.url} → ${res.statusCode}${ms}${id}`
                }
                // In-request log (has request context, no response yet) -> prefix the message.
                if (req?.method) {
                    return `${req.method} ${req.url} — ${msg}`
                }
                return msg
            },
        }),
    })
}

if (toFile) {
    // Ensure the log directory exists before opening the rotating stream.
    mkdirSync(dir, { recursive: true })
    streams.push({
        level,
        stream: createStream(logFileName, {
            path: dir,
            interval: rotation.interval,
            size: rotation.size,
            compress: rotation.compress,
            maxFiles: rotation.maxFiles,
        }),
    })
}

const rootLogger: Logger = pino(options, pino.multistream(streams))

// In cluster mode, tag every record with the worker slot so the per-worker files
// (and any later aggregation) are attributable. pid/hostname stay from pino's
// defaults; child module loggers inherit this binding.
export const logger: Logger =
    workerIndex === null ? rootLogger : rootLogger.child({ worker: Number(workerIndex) })

/** Creates a child logger with bound context, e.g. `createLogger({ module: "users" })`. */
export function createLogger(bindings: Record<string, unknown>): Logger {
    return logger.child(bindings)
}
