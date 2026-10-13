import { createAccessCheck } from "@app/auth";
import { LOG_FILES } from "@app/core";
import type { Request, RequestHandler, Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";

import { configuredLogStreams, type LogStreams } from "../helpers/log-stream.ts";

/**
 * A live view of the logs — the one thing an operator needs from the
 * running process that the console (the `config` module) cannot give
 * them. Reachable only by `sysadmin` — see module.acl.ts — and re-checked
 * while the stream is open, since a stream outlives the request that
 * opened it.
 */
export class BoSettingsController {
  readonly #logStreams: LogStreams;
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    this.#logStreams = configuredLogStreams(ctx);
  }

  logStream(): RequestHandler {
    return async (req: Request, res: Response) => {
      // Where the core module's logger writes, from its environment values.
      const { logFile, logDir } = this.#ctx.config.core!;
      if (!logFile) {
        throw new HttpError(409, "fileLoggingDisabled", {
          code: "FILE_LOGGING_DISABLED",
          defaultMessage: "LOG_FILE is off — there are no log files to stream",
        });
      }

      const which = req.query.process === "worker" ? "worker" : "backend";
      const level =
        typeof req.query.level === "string" ? req.query.level : undefined;
      const tail = Math.min(Number(req.query.tail ?? 200) || 0, 1000);

      const session = req.auth.session;
      await this.#logStreams.open(res, {
        authorize: createAccessCheck(this.#ctx, req.auth, "settings:bo:logs"),
        userId: req.auth.user ? String(req.auth.user._id) : "",
        expiresAt: session
          ? Math.min(
              session.access_expires_at.getTime(),
              session.expires_at.getTime(),
            )
          : 0,
        dir: logDir,
        prefix: `${LOG_FILES.basename}-${which}`,
        process: which,
        tail,
        ...(level ? { level } : {}),
      });
    };
  }
}
