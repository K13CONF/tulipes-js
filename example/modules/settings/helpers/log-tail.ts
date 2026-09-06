import { createReadStream, existsSync, readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Follows the app's log files.
 *
 * Reading the FILES rather than hooking the logger in-process is what lets
 * this see the worker: backend and worker are separate processes writing
 * separate files, and an in-process stream could only ever show its own.
 *
 * pino-roll rotates by renaming and starting a new file, so a naive
 * `watch` on one path goes silent the moment the log rolls. This resolves
 * the newest matching file on every tick instead, and reopens when it
 * changes.
 */
export interface TailOptions {
  dir: string;
  /** Basename prefix, e.g. "app-backend" — matched against `<prefix>*.log`. */
  prefix: string;
  /** Lines of history to send before following. */
  tail: number;
  onLine: (line: string) => void;
}

export interface Tail {
  close(): void;
}

export function tailLogs(options: TailOptions): Tail {
  let current = newestFile(options.dir, options.prefix);
  let offset = 0;
  let closed = false;
  let reading = false;

  const pump = async (): Promise<void> => {
    if (closed || reading) return;
    reading = true;
    try {
      const newest = newestFile(options.dir, options.prefix);

      // A rotation swapped the file underneath us: start the new one from
      // the beginning, or its first entries are lost.
      if (newest !== current) {
        current = newest;
        offset = 0;
      }
      if (!current) return;

      const size = statSync(current).size;
      // Truncation (a fresh file reusing the name) looks like the offset
      // running past the end; rewinding is the only correct response.
      if (size < offset) offset = 0;
      if (size === offset) return;

      await readFrom(current, offset, size, options.onLine);
      offset = size;
    } catch {
      // A file vanishing mid-rotation is normal; the next tick reopens.
    } finally {
      reading = false;
    }
  };

  // History first — a console opened after something broke is useless if
  // it starts empty.
  if (current) {
    const size = statSync(current).size;
    offset = Math.max(0, size);
    void lastLines(current, options.tail).then((lines) => {
      if (!closed) lines.forEach(options.onLine);
    });
  }

  // Watching alone is not enough: appends to an open file do not always
  // raise an event on every platform, so a slow poll backs it up.
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(options.dir, () => void pump());
  } catch {
    // No inotify (some containers): the interval below carries it.
  }
  const timer = setInterval(() => void pump(), 1000);

  return {
    close() {
      closed = true;
      clearInterval(timer);
      watcher?.close();
    },
  };
}

/** pino-roll appends a date and index, so the newest file wins by mtime. */
function newestFile(dir: string, prefix: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".log"))
    .map((name) => join(dir, name));
  if (candidates.length === 0) return undefined;

  return candidates.reduce((newest, file) =>
    statSync(file).mtimeMs > statSync(newest).mtimeMs ? file : newest,
  );
}

function readFrom(
  file: string,
  start: number,
  end: number,
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file, { start, end: end - 1, encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    lines.on("line", (line) => line.trim() && onLine(line));
    lines.on("close", () => resolve());
    stream.on("error", reject);
  });
}

/**
 * The last `count` lines, read by streaming the whole file and keeping a
 * bounded window. A log file is capped by LOG_ROTATION_SIZE, so this is
 * bounded work — and the window never exceeds `count` entries in memory.
 */
async function lastLines(file: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const window: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      window.push(line);
      if (window.length > count) window.shift();
    });
    lines.on("close", () => resolve());
    stream.on("error", reject);
  });

  return window;
}
