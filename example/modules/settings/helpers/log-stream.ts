import type { Response } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";
import { AccessLease } from "./access-lease.ts";
import { tailLogs, type Tail } from "./log-tail.ts";

export const LOG_STREAM_LIMITS = Object.freeze({
  connections: 4,
  perUser: 2,
  durationMs: 60_000,
  outputBytes: 1024 * 1024,
  bufferBytes: 64 * 1024,
  heartbeatMs: 15_000,
  authorizationIntervalMs: 1000,
  authorizationTimeoutMs: 1000,
});

type StreamLimits = { [K in keyof typeof LOG_STREAM_LIMITS]: number };

interface StreamOptions {
  authorize: (signal: AbortSignal) => Promise<boolean>;
  userId: string;
  expiresAt: number;
  dir: string;
  prefix: string;
  process: "backend" | "worker";
  tail: number;
  level?: string;
}

const LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** One manager per boot: the context object is what a boot has exactly one of. */
const instances = new WeakMap<Ctx, LogStreams>();

/** Keep the stopped instance until the boot is collected; late requests cannot reopen it. */
export function configuredLogStreams(ctx: Ctx): LogStreams {
  let streams = instances.get(ctx);
  if (!streams) {
    streams = new LogStreams();
    instances.set(ctx, streams);
  }
  return streams;
}

/** One boot owns its slots. Replicas each enforce this local resource cap. */
export class LogStreams {
  readonly #active = new Map<string, number>();
  readonly #closeStreams = new Set<() => void>();
  #draining = false;
  #count = 0;
  readonly #limits: StreamLimits;

  constructor(limits: Partial<StreamLimits> = {}) {
    this.#limits = { ...LOG_STREAM_LIMITS, ...limits };

    if (
      Object.values(this.#limits).some(
        (value) =>
          !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647,
      )
    ) {
      throw new Error(
        "Log stream limits must be positive integers no greater than 2147483647",
      );
    }
  }

  /** Stop admission and output now; never wait for an uncooperative authorization query. */
  drain(): void {
    this.#draining = true;
    for (const close of this.#closeStreams) close();
  }

  async open(res: Response, options: StreamOptions): Promise<void> {
    const unavailable = () => new HttpError(503, "logStreamsDraining", {
      code: "LOG_STREAMS_DRAINING",
      defaultMessage: "Log streams are unavailable during shutdown",
    });
    if (this.#draining) throw unavailable();
    // The credential's expiry is absolute; the stream's own duration starts
    // once it is ready, so a slow authorization round trip or file open cannot
    // eat into it and turn a valid credential into a refusal.
    let expiresAt = options.expiresAt;
    if (!options.userId || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      throw new HttpError(401, "unauthorized");
    }

    const owned = this.#active.get(options.userId) ?? 0;

    if (
      owned >= this.#limits.perUser ||
      this.#count >= this.#limits.connections
    ) {
      res.setHeader("Retry-After", "1");
      throw new HttpError(429, "tooManyLogStreams", {
        code: "TOO_MANY_LOG_STREAMS",
        defaultMessage: "Too many open log streams",
      });
    }

    // Reserve capacity before opening files or committing the SSE response.
    this.#count++;
    this.#active.set(options.userId, owned + 1);

    let closed = false;
    let sent = 0;
    let tail: Tail | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const authorization = new AccessLease(
      options.authorize,
      this.#limits.authorizationIntervalMs,
      this.#limits.authorizationTimeoutMs,
      () => close(),
    );

    const releaseSlot = () => {
      this.#count--;
      const remaining = (this.#active.get(options.userId) ?? 1) - 1;
      if (remaining) this.#active.set(options.userId, remaining);
      else this.#active.delete(options.userId);
    };

    // All termination paths converge here; repeated events cannot release twice.
    const close = (destroy = false) => {
      if (closed) return;

      closed = true;
      this.#closeStreams.delete(close);
      clearTimeout(deadline);
      clearInterval(heartbeat);
      tail?.close();

      // A timed-out query may still run. Hold its slot until it settles so
      // reconnects cannot create an unbounded queue of authorization work.
      void authorization.close().then(releaseSlot);

      res.off("close", disconnected);
      res.off("error", disconnected);

      if (destroy) res.destroy();
      else if (res.headersSent && !res.destroyed && !res.writableEnded) {
        res.end();

        // A peer may stop draining even below write()'s high-water mark.
        const finish = setTimeout(() => {
          if (!res.writableFinished) res.destroy();
        }, 1000);
        finish.unref();
        res.once("finish", () => clearTimeout(finish));
        res.once("close", () => clearTimeout(finish));
      }
    };

    const disconnected = () => close();

    // Bound application output before handing another frame to Node's buffer.
    const write = (frame: string): boolean => {
      if (closed) return false;

      if (Date.now() >= expiresAt || !authorization.valid) {
        close();
        return false;
      }

      const bytes = Buffer.byteLength(frame);

      if (sent + bytes > this.#limits.outputBytes) {
        close();
        return false;
      }
      if (
        res.destroyed ||
        res.writableLength + bytes > this.#limits.bufferBytes
      ) {
        close(true);
        return false;
      }

      sent += bytes;

      try {
        if (!res.write(frame)) {
          close(true);
          return false;
        }
      } catch {
        close(true);
        return false;
      }
      return true;
    };

    const send = (event: string, data: unknown) =>
      write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");

    res.once("close", disconnected);
    res.once("error", disconnected);
    this.#closeStreams.add(close);

    try {
      // Recheck before file access or SSE headers, closing the opening-request gap.
      await authorization.start();
      if (this.#draining && !res.destroyed && !res.headersSent) throw unavailable();
      if (closed) return;

      tail = tailLogs({
        dir: options.dir,
        prefix: options.prefix,
        tail: options.tail,
        onLine: (line) => {
          let entry: unknown;
          try {
            entry = JSON.parse(line);
          } catch {
            entry = { msg: line };
          }

          const level =
            entry &&
            typeof entry === "object" &&
            "level" in entry &&
            typeof entry.level === "number"
              ? entry.level
              : 0;
          if (level < (LEVELS[options.level ?? ""] ?? 0)) return true;
          return send("log", entry);
        },
        onError: (code) => {
          send("error", { code });
          close();
        },
      });
      if (Date.now() >= expiresAt) throw new HttpError(401, "unauthorized");
      expiresAt = Math.min(expiresAt, Date.now() + this.#limits.durationMs);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      if (
        !send("ready", {
          process: options.process,
          tail: options.tail,
          level: options.level ?? "all",
        })
      )
        return;

      deadline = setTimeout(() => close(), Math.max(1, expiresAt - Date.now()));
      heartbeat = setInterval(
        () => write(": keep-alive\n\n"),
        this.#limits.heartbeatMs,
      );
      deadline.unref();
      heartbeat.unref();
    } catch (error) {
      close();
      throw error;
    }
  }
}
