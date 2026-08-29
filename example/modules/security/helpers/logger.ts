import { pino, type Logger } from "pino";
import type { Environment } from "@tulipes/core/env";

let instance: Logger | undefined;

/**
 * The app's pino logger — JSON lines in production (ready for shipping to a
 * log collector), pretty-printed in development. Level comes from the
 * module's LOG_LEVEL variable, so a deploy can turn on debug without a
 * code change.
 */
export function logger(environment: Environment): Logger {
  if (instance) return instance;

  instance = pino({
    level: String(environment.get("LOG_LEVEL")),
    ...(environment.appEnv === "development" && {
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
    }),
  });
  return instance;
}
