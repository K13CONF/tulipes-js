import { resolve } from "node:path"
import env from "@config/env.js"

/**
 * Logger configuration, derived from the environment. This is the single source
 * of truth for how the logger behaves; `src/lib/logger.ts` only wires Pino up
 * from these values.
 */

const isProduction = env.NODE_ENV === "production"

export const loggerConfig = {
    /** Minimum level to emit. */
    level: env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),

    /** Pretty, colored console (dev) vs. raw JSON to stdout (prod). */
    pretty: !isProduction,

    /** Whether to also write a rotated JSON file. */
    toFile: env.LOG_TO_FILE ? env.LOG_TO_FILE === "true" : true,

    /** Absolute directory for log files (LOG_DIR is resolved against the cwd). */
    dir: resolve(env.LOG_DIR),

    /** File rotation policy: daily or at 20MB, gzipped, keep 14 files. */
    rotation: {
        interval: "1d",
        size: "20M",
        compress: "gzip",
        maxFiles: 14,
    },
} as const
