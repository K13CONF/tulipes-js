import { mkdirSync } from "node:fs"
import { hostname } from "node:os"
import { resolve } from "node:path"
import pino, { type Logger, type LoggerOptions, type StreamEntry } from "pino"
import { createStream } from "rotating-file-stream"
import env from "./env.js"

/**
 * Application logger (Pino) and its configuration — owned entirely by the config
 * layer.
 *
 * - Console: colored, human-friendly when `pretty` (development only); raw JSON
 *   to stdout otherwise.
 * - File: newline-delimited JSON, rotated daily or at 20MB, keeping 14 files in
 *   `LOG_DIR` (default ./logs) — grep/jq/Loki/ELK queryable. Under PM2, set
 *   `LOG_TO_FILE=false` and let PM2 capture stdout instead.
 * - Secrets are redacted so they never reach a transport.
 */

// Only development gets pretty/verbose output; staging + production are
// treated as production-like (JSON, info level).
const isDevelopment = env.NODE_ENV === "development"

// ── Configuration (derived from env) ───────────────────────────────────────
const level = env.LOG_LEVEL ?? (isDevelopment ? "debug" : "info")
const pretty = isDevelopment
const toFile = env.LOG_TO_FILE ? env.LOG_TO_FILE === "true" : true
const dir = resolve(env.LOG_DIR) // absolute; LOG_DIR is relative to the cwd
const rotation = {
    interval: "1d",
    size: "20M",
    // compress: "gzip", // Keep this commented in most cases — storage won't be a problem
    compress: false,
    maxFiles: 14
} as const

// Clustering is owned by PM2 (the app no longer forks via node:cluster). Each
// PM2 instance is its own process; with file logging on, point distinct
// instances at distinct LOG_DIRs, or prefer `LOG_TO_FILE=false` + PM2 capture.
const baseName = "app"

// PM2 sets `process.env.name` to the app name (bp-web / bp-worker). Stamp it on
// every line so the merged `pm2 logs` console (and `pm2:logs` → pino-pretty) can
// tell the web and worker processes apart. Falls back to pino's default
// `{ pid, hostname }` base when not running under PM2.
const processName = process.env.name
const base = processName
    ? { pid: process.pid, hostname: hostname(), name: processName }
    : undefined

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
    // Omit `base` entirely when not under PM2 so pino keeps its default
    // `{ pid, hostname }` (assigning undefined is rejected by exactOptionalPropertyTypes).
    ...(base && { base }),
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
            initialRotation: true,
            interval: rotation.interval,
            size: rotation.size,
            compress: rotation.compress,
            maxFiles: rotation.maxFiles,
        }),
    })
}

export const logger: Logger = pino(options, pino.multistream(streams))

/** Creates a child logger with bound context, e.g. `createLogger({ module: "users" })`. */
export function createLogger(bindings: Record<string, unknown>): Logger {
    return logger.child(bindings)
}
