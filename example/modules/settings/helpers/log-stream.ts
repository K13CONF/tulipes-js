import type { Response } from "express";
import { HttpError } from "@tulipes/core/http";
import { tailLogs, type Tail } from "./log-tail.js";

export const LOG_STREAM_LIMITS = Object.freeze({
  connections: 4, perUser: 2, durationMs: 60_000, outputBytes: 1024 * 1024,
  bufferBytes: 64 * 1024, heartbeatMs: 15_000,
});

type StreamLimits = { [K in keyof typeof LOG_STREAM_LIMITS]: number };

interface StreamOptions {
  userId: string;
  expiresAt: number;
  dir: string;
  prefix: string;
  process: "backend" | "worker";
  tail: number;
  level?: string;
}
const LEVELS: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

/** One controller/boot owns its slots. Replicas each enforce this local resource cap. */
export class LogStreams {
  readonly #active = new Map<string, number>();
  #count = 0;
  readonly #limits: StreamLimits;

  constructor(limits: Partial<StreamLimits> = {}) {
    this.#limits = { ...LOG_STREAM_LIMITS, ...limits };
    if (Object.values(this.#limits).some(value => !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)) {
      throw new Error("Log stream limits must be positive integers no greater than 2147483647");
    }
  }

  open(res: Response, options: StreamOptions): void {
    const lifetime = Math.min(this.#limits.durationMs, options.expiresAt - Date.now());
    if (!options.userId || !Number.isFinite(lifetime) || lifetime <= 0) throw new HttpError(401, "unauthorized");
    const expiresAt = Date.now() + lifetime;
    const owned = this.#active.get(options.userId) ?? 0;
    if (owned >= this.#limits.perUser || this.#count >= this.#limits.connections) {
      res.setHeader("Retry-After", "1");
      throw new HttpError(429, "tooManyLogStreams", { code: "TOO_MANY_LOG_STREAMS", defaultMessage: "Too many open log streams" });
    }
    this.#count++;
    this.#active.set(options.userId, owned + 1);
    let closed = false;
    let sent = 0;
    let tail: Tail | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const close = (destroy = false) => {
      if (closed) return;
      closed = true;
      clearTimeout(deadline); clearInterval(heartbeat); tail?.close();
      this.#count--;
      const remaining = (this.#active.get(options.userId) ?? 1) - 1;
      if (remaining) this.#active.set(options.userId, remaining); else this.#active.delete(options.userId);
      res.off("close", disconnected); res.off("error", disconnected);
      if (destroy) res.destroy();
      else if (res.headersSent && !res.destroyed && !res.writableEnded) {
        res.end();
        // A peer may stop draining even below write()'s high-water mark.
        const finish = setTimeout(() => { if (!res.writableFinished) res.destroy(); }, 1000);
        finish.unref();
        res.once("finish", () => clearTimeout(finish));
        res.once("close", () => clearTimeout(finish));
      }
    };
    const disconnected = () => close();
    const write = (frame: string): boolean => {
      if (closed) return false;
      if (Date.now() >= expiresAt) { close(); return false; }
      const bytes = Buffer.byteLength(frame);
      if (sent + bytes > this.#limits.outputBytes) { close(); return false; }
      if (res.destroyed || res.writableLength + bytes > this.#limits.bufferBytes) { close(true); return false; }
      sent += bytes;
      try { if (!res.write(frame)) { close(true); return false; } }
      catch { close(true); return false; }
      return true;
    };
    const send = (event: string, data: unknown) => write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
    res.once("close", disconnected); res.once("error", disconnected);
    try {
      tail = tailLogs({ dir: options.dir, prefix: options.prefix, tail: options.tail,
        onLine: line => {
          let entry: unknown;
          try { entry = JSON.parse(line); } catch { entry = { msg: line }; }
          const level = entry && typeof entry === "object" && "level" in entry && typeof entry.level === "number" ? entry.level : 0;
          if (level < (LEVELS[options.level ?? ""] ?? 0)) return true;
          return send("log", entry);
        },
        onError: code => { send("error", { code }); close(); },
      });
      if (Date.now() >= expiresAt) throw new HttpError(401, "unauthorized");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive", "X-Accel-Buffering": "no" });
      if (!send("ready", { process: options.process, tail: options.tail, level: options.level ?? "all" })) return;
      deadline = setTimeout(() => close(), Math.max(1, expiresAt - Date.now()));
      heartbeat = setInterval(() => write(": keep-alive\n\n"), this.#limits.heartbeatMs);
      deadline.unref(); heartbeat.unref();
    } catch (error) { close(); throw error; }
  }
}
