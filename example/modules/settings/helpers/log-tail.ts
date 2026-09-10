import { constants, lstatSync, opendirSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "@tulipes/core/http";

export const LOG_TAIL_LIMITS = Object.freeze({
  historyBytes: 256 * 1024,
  chunkBytes: 64 * 1024,
  lineBytes: 16 * 1024,
  readBytes: 8 * 1024 * 1024,
  directoryEntries: 1024,
  pollMs: 1000,
});

export interface TailOptions {
  dir: string;
  /** Exact basename before the optional pino date/index suffix. */
  prefix: string;
  tail: number;
  /** Returning false stops reading immediately. */
  onLine: (line: string) => boolean | void;
  onError?: (code: "LOG_UNAVAILABLE" | "LOG_READ_LIMIT") => void;
}

export interface Tail {
  readonly ready: Promise<void>;
  readonly closed: boolean;
  close(): void;
}

const unsafe = () =>
  new HttpError(409, "logFileUnsafe", {
    code: "LOG_FILE_UNSAFE",
    defaultMessage: "Logs must be regular, unlinked files in a real directory",
  });

/** Trusted ancestors are an operator responsibility, as for settings file access. */
function newestFile(dir: string, prefix: string): string | undefined {
  const parent = lstatSync(dir, { throwIfNoEntry: false });
  if (!parent) return undefined;
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw unsafe();
  const pattern = new RegExp(
    "^" +
      prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?:\\.\\d{4}-\\d{2}-\\d{2})?(?:\\.\\d+)?\\.log$",
  );
  const handle = opendirSync(dir);
  let newest: { file: string; mtime: number } | undefined;
  let count = 0;
  try {
    for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
      if (++count > LOG_TAIL_LIMITS.directoryEntries) throw unsafe();
      if (!pattern.test(entry.name)) continue;
      const file = join(dir, entry.name);
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (!stat) continue; // Rotation may remove an entry during enumeration.
      if (!stat.isFile() || stat.nlink !== 1) throw unsafe();
      if (
        !newest ||
        stat.mtimeMs > newest.mtime ||
        (stat.mtimeMs === newest.mtime &&
          file.localeCompare(newest.file, undefined, { numeric: true }) > 0)
      ) {
        newest = { file, mtime: stat.mtimeMs };
      }
    }
  } finally {
    handle.closeSync();
  }
  return newest?.file;
}

export function tailLogs(options: TailOptions): Tail {
  if (
    !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(options.prefix) ||
    !Number.isInteger(options.tail) ||
    options.tail < 0 ||
    options.tail > 1000
  )
    throw unsafe();
  // Validate before the caller commits SSE headers. Later errors are signaled.
  try {
    newestFile(options.dir, options.prefix);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "logsUnavailable", {
      code: "LOG_UNAVAILABLE",
      defaultMessage: "Log files are unavailable",
    });
  }
  let closed = false;
  let reading = false;
  let first = true;
  let identity = "";
  let offset = 0;
  let totalRead = 0;
  let pending = Buffer.alloc(0);
  let dropping = false;
  let active: FileHandle | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearImmediate(initial);
    pending = Buffer.alloc(0);
    void active?.close().catch(() => {});
    resolveReady();
  };
  const fail = (code: "LOG_UNAVAILABLE" | "LOG_READ_LIMIT") => {
    close();
    try {
      options.onError?.(code);
    } catch {
      /* Never reject a background task. */
    }
  };
  const emit = async (line: string) => {
    if (!closed && options.onLine(line) === false) close();
    // Let a healthy socket flush between history records. A false return still
    // stops immediately, and only one yield/read can be outstanding per tail.
    if (!closed) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const consume = async (buffer: Buffer, history: boolean) => {
    const lines: string[] = [];
    let start = 0;
    while (start < buffer.length && !closed) {
      const newline = buffer.indexOf(10, start);
      const end = newline === -1 ? buffer.length : newline;
      const part = buffer.subarray(start, end);
      if (!dropping) {
        if (pending.length + part.length > LOG_TAIL_LIMITS.lineBytes) {
          pending = Buffer.alloc(0);
          dropping = true;
        } else pending = Buffer.concat([pending, part]);
      }
      if (newline === -1) break;
      if (!dropping) {
        const line = pending.toString("utf8").replace(/\r$/, "");
        if (line.trim()) {
          if (history) {
            lines.push(line);
            if (lines.length > options.tail) lines.shift();
          } else await emit(line);
        }
      }
      pending = Buffer.alloc(0);
      dropping = false;
      start = newline + 1;
    }
    for (const line of lines) {
      if (closed) break;
      await emit(line);
    }
  };
  const pump = async () => {
    if (closed || reading) return;
    reading = true;
    let file: FileHandle | undefined;
    try {
      const newest = newestFile(options.dir, options.prefix);
      if (!newest) {
        first = false;
        return;
      }
      file = await open(
        newest,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      if (closed) return;
      active = file;
      const stat = await file.stat();
      if (closed) return;
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        !Number.isSafeInteger(stat.size)
      )
        throw unsafe();
      const nextIdentity = stat.dev + ":" + stat.ino;
      if (identity !== nextIdentity || stat.size < offset) {
        offset = 0;
        pending = Buffer.alloc(0);
        dropping = false;
        identity = nextIdentity;
      }
      const history = first;
      first = false;
      if (history) {
        offset = options.tail
          ? Math.max(0, stat.size - LOG_TAIL_LIMITS.historyBytes)
          : stat.size;
        dropping = offset > 0; // Discard a possible fragment at the window start.
        if (!options.tail && stat.size) {
          const last = Buffer.alloc(1);
          await file.read(last, 0, 1, stat.size - 1);
          totalRead++;
          dropping = last[0] !== 10;
        }
      }
      const size = Math.min(
        stat.size - offset,
        history ? LOG_TAIL_LIMITS.historyBytes : LOG_TAIL_LIMITS.chunkBytes,
      );
      if (size <= 0 || closed) return;
      if (totalRead + size > LOG_TAIL_LIMITS.readBytes) {
        fail("LOG_READ_LIMIT");
        return;
      }
      const buffer = Buffer.alloc(size);
      let bytesRead = 0;
      while (bytesRead < size && !closed) {
        const part = await file.read(
          buffer,
          bytesRead,
          size - bytesRead,
          offset + bytesRead,
        );
        if (!part.bytesRead) break;
        bytesRead += part.bytesRead;
      }
      if (closed) return;
      offset += bytesRead;
      totalRead += bytesRead;
      await consume(buffer.subarray(0, bytesRead), history);
    } catch (error) {
      if (
        !closed &&
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        fail("LOG_UNAVAILABLE");
    } finally {
      if (file) await file.close().catch(() => {});
      active = undefined;
      reading = false;
      resolveReady();
    }
  };
  // A fixed poll bounds work under write storms; there is no event-driven read loop.
  const timer = setInterval(() => void pump(), LOG_TAIL_LIMITS.pollMs);
  timer.unref();
  const initial = setImmediate(() => void pump());
  return {
    ready,
    get closed() {
      return closed;
    },
    close,
  };
}
