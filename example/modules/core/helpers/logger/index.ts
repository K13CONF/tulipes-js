import { join } from "node:path";
// Default import, not the named one: pino.transport lives on the
// namespace that only the default export carries.
import pino from "pino";
import type { Logger, TransportTargetOptions } from "pino";
import type { ProcessMode } from "@tulipes/core/boot";
import type { Environment } from "@tulipes/core/env";

/**
 * The app's logger, shared by every module.
 *
 * Two destinations at once, because they answer different questions:
 *
 *   console  pretty and coloured, for a human watching a terminal
 *   files    JSON lines, for grep/jq/Loki/CloudWatch — one object per
 *            line with a stable shape, which is what makes logs queryable
 *
 * Files are named per process mode. Backend and worker run at the same
 * time, and two processes rotating one file race: both notice the size
 * limit, both rename, and one of them loses entries. Separate files cost
 * nothing and remove the failure entirely.
 */
let instance: Logger | undefined;

/**
 * How the files are named and rotated. These never needed to differ per
 * deployment, so they are constants rather than environment variables;
 * the settings module's log stream reads the same names.
 */
export const LOG_FILES = Object.freeze({
  /** Base name of the all-levels file; the process mode and date are appended. */
  basename: "app",
  /** Base name of the errors-only file. */
  errorBasename: "error",
  /** Rotate on this schedule: "daily", "hourly", or milliseconds. */
  rotationFrequency: "daily",
  /** Also rotate once a file reaches this size. */
  rotationSize: "20m",
  /** How many rotated files to keep per destination, besides the current one. */
  retentionFiles: 14,
});

export function logger(environment: Environment, mode: ProcessMode = "backend"): Logger {
  if (instance) return instance;

  const level = String(environment.get("LOG_LEVEL"));
  const targets: TransportTargetOptions[] = [];

  if (Boolean(environment.get("LOG_CONSOLE"))) {
    targets.push({
      target: "pino-pretty",
      level,
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        // pid and hostname matter in aggregated files, not on the terminal
        // of the machine that is obviously running it.
        ignore: "pid,hostname",
        messageFormat: "{if module}[{module}] {end}{msg}",
      },
    });
  }

  if (Boolean(environment.get("LOG_FILE"))) {
    const dir = String(environment.get("LOG_DIR"));
    const rotation = {
      // Both limits apply: whichever trips first rotates the file.
      frequency: LOG_FILES.rotationFrequency,
      size: LOG_FILES.rotationSize,
      limit: { count: LOG_FILES.retentionFiles },
      extension: ".log",
      dateFormat: "yyyy-MM-dd",
      mkdir: true,
    };

    targets.push({
      target: "pino-roll",
      level,
      options: { ...rotation, file: join(dir, `${LOG_FILES.basename}-${mode}`) },
    });

    // A second copy of errors only. Everything here is also in the main
    // file; the point is a small file to open first when something breaks,
    // instead of paging through a day of request logs.
    targets.push({
      target: "pino-roll",
      level: "error",
      options: {
        ...rotation,
        file: join(dir, `${LOG_FILES.errorBasename}-${mode}`),
      },
    });
  }

  instance = targets.length
    ? pino({ level, base: { mode } }, pino.transport({ targets }))
    : // Every destination disabled: still return a working logger rather
      // than null-checking at a hundred call sites.
      pino({ level, base: { mode } });

  return instance;
}

/**
 * A logger tagged with the module it belongs to, so a line's origin is
 * visible in both destinations: `[users] ready` on the console, and a
 * queryable `"module":"users"` field in the file.
 */
export function moduleLogger(
  environment: Environment,
  name: string,
  mode: ProcessMode = "backend",
): Logger {
  return logger(environment, mode).child({ module: name });
}
