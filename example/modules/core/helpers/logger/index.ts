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
      frequency: String(environment.get("LOG_ROTATION_FREQUENCY")),
      size: String(environment.get("LOG_ROTATION_SIZE")),
      limit: { count: Number(environment.get("LOG_RETENTION_FILES")) },
      extension: ".log",
      dateFormat: "yyyy-MM-dd",
      mkdir: true,
    };

    targets.push({
      target: "pino-roll",
      level,
      options: { ...rotation, file: join(dir, `${environment.get("LOG_BASENAME")}-${mode}`) },
    });

    // A second copy of errors only. Everything here is also in the main
    // file; the point is a small file to open first when something breaks,
    // instead of paging through a day of request logs.
    targets.push({
      target: "pino-roll",
      level: "error",
      options: {
        ...rotation,
        file: join(dir, `${environment.get("LOG_ERROR_BASENAME")}-${mode}`),
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
