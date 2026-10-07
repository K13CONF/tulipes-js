import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  linkSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { symlinkSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { setTimeout } from "node:timers/promises";
import {
  LOG_TAIL_LIMITS,
  tailLogs,
} from "../../../example/modules/settings/helpers/log-tail.ts";

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tulipes-tail-"));

  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("history refuses symlinked log files without reading their target", () =>
  fixture(async (dir) => {
    writeFileSync(join(dir, "private"), "secret canary\n");

    symlinkSync(join(dir, "private"), join(dir, "app-backend.log"));

    const lines: string[] = [];
    let tail: ReturnType<typeof tailLogs> | undefined;

    try {
      expect(() => {
        tail = tailLogs({
          dir,
          prefix: "app-backend",
          tail: 10,
          onLine: (line) => {
            lines.push(line);
          },
        });
      }).toThrow();

      await setTimeout(30);

      expect(lines).toEqual([]);
    } finally {
      tail?.close();
    }
  }));

test("log history does not include a different basename sharing its prefix", () =>
  fixture(async (dir) => {
    writeFileSync(join(dir, "app-backend-private.log"), "unrelated\n");

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 10,
      onLine: (line) => {
        lines.push(line);
      },
    });

    try {
      await setTimeout(50);

      expect(lines).toEqual([]);
    } finally {
      tail.close();
    }
  }));

test("oversized history lines are never delivered", () =>
  fixture(async (dir) => {
    writeFileSync(join(dir, "app-backend.log"), "x".repeat(32 * 1024) + "\n");

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 10,
      onLine: (line) => {
        lines.push(line);
      },
    });

    try {
      await setTimeout(50);

      expect(lines).toEqual([]);
    } finally {
      tail.close();
    }
  }));

test("bounded history preserves the last complete lines and completes a UTF-8 fragment later", () =>
  fixture(async (dir) => {
    const file = join(dir, "app-backend.2026-09-10.1.log");

    writeFileSync(file, "older\nlast\npart ");

    appendFileSync(file, Buffer.from([0xe2, 0x82]));

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 1,
      onLine: (line) => {
        lines.push(line);
      },
    });

    try {
      await tail.ready;

      expect(lines).toEqual(["last"]);

      appendFileSync(file, Buffer.from([0xac, 10]));

      await vi.waitFor(() => expect(lines).toEqual(["last", "part €"]), {
        timeout: 2000,
      });
    } finally {
      tail.close();
    }
  }));

test("history byte window skips old data and never emits an initial fragment", () =>
  fixture(async (dir) => {
    writeFileSync(
      join(dir, "app-backend.log"),
      "old\n" + "x".repeat(LOG_TAIL_LIMITS.historyBytes) + "\nlast\n",
    );

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 1000,
      onLine: (line) => {
        lines.push(line);
      },
    });

    try {
      await tail.ready;

      expect(lines).toEqual(["last"]);
    } finally {
      tail.close();
    }
  }));

test("tail zero skips existing content and an unfinished line", () =>
  fixture(async (dir) => {
    const file = join(dir, "app-backend.log");

    writeFileSync(file, "old\nunfinished");

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 0,
      onLine: (line) => {
        lines.push(line);
      },
    });

    try {
      await tail.ready;

      expect(lines).toEqual([]);

      appendFileSync(file, " rest\nnew\n");

      await vi.waitFor(() => expect(lines).toEqual(["new"]), { timeout: 2000 });
    } finally {
      tail.close();
    }
  }));

test("same-name rotation resets the inode and truncation resets the offset", () =>
  fixture(async (dir) => {
    const file = join(dir, "app-backend.log");

    writeFileSync(file, "original long line\n");

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 10,
      onLine: (line) => {
        lines.push(line);
      },
    });

    try {
      await tail.ready;

      renameSync(file, join(dir, "archived"));

      writeFileSync(file, "replacement even longer line\n");

      await vi.waitFor(
        () => expect(lines.at(-1)).toBe("replacement even longer line"),
        { timeout: 2000 },
      );

      writeFileSync(file, "short\n");

      await vi.waitFor(() => expect(lines.at(-1)).toBe("short"), {
        timeout: 2000,
      });
    } finally {
      tail.close();
    }
  }));

test("a consumer stop suppresses further lines and close cancels initial work", () =>
  fixture(async (dir) => {
    writeFileSync(join(dir, "app-backend.log"), "one\ntwo\nthree\n");

    const lines: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 10,
      onLine: (line) => {
        lines.push(line);

        return false;
      },
    });

    await tail.ready;

    expect(lines).toEqual(["one"]);
    expect(tail.closed).toBe(true);

    const cancelled = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 10,
      onLine: (line) => {
        lines.push(line);
      },
    });

    cancelled.close();

    await cancelled.ready;

    expect(lines).toEqual(["one"]);
  }));

test.each(["hardlink", "directory", "parent-link"])(
  "unsafe log %s is rejected before reading",
  (kind) =>
    fixture(async (dir) => {
      const file = join(dir, "app-backend.log");

      writeFileSync(join(dir, "private"), "canary\n");

      let root = dir;

      if (kind === "hardlink") linkSync(join(dir, "private"), file);
      else if (kind === "directory") mkdirSync(file);
      else {
        root = join(dir, "linked");

        symlinkSync(dir, root);
      }

      expect(() =>
        tailLogs({
          dir: root,
          prefix: "app-backend",
          tail: 10,
          onLine: () => {},
        }),
      ).toThrow();
    }),
);

test("unsafe files introduced during follow terminate with a sanitized error", () =>
  fixture(async (dir) => {
    const lines: string[] = [];
    const errors: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 10,
      onLine: (line) => {
        lines.push(line);
      },
      onError: (code) => {
        errors.push(code);
      },
    });

    try {
      await tail.ready;

      writeFileSync(join(dir, "private"), "canary\n");

      symlinkSync(join(dir, "private"), join(dir, "app-backend.log"));

      await vi.waitFor(() => expect(errors).toEqual(["LOG_UNAVAILABLE"]), {
        timeout: 2000,
      });

      expect(lines).toEqual([]);
      expect(tail.closed).toBe(true);
    } finally {
      tail.close();
    }
  }));

test("directory enumeration and invalid tail options fail before opening a tail", () =>
  fixture(async (dir) => {
    for (let i = 0; i <= LOG_TAIL_LIMITS.directoryEntries; i++)
      writeFileSync(join(dir, String(i)), "");

    expect(() =>
      tailLogs({ dir, prefix: "app-backend", tail: 10, onLine: () => {} }),
    ).toThrow();

    for (const tail of [-1, 1.5, 1001, NaN])
      expect(() =>
        tailLogs({ dir, prefix: "app-backend", tail, onLine: () => {} }),
      ).toThrow();

    expect(() =>
      tailLogs({ dir, prefix: "../outside", tail: 10, onLine: () => {} }),
    ).toThrow();
  }));

test("filtered or oversized live data still consumes a bounded read budget", () =>
  fixture(async (dir) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const file = join(dir, "app-backend.log");

    writeFileSync(file, "\n");

    const errors: string[] = [];

    const tail = tailLogs({
      dir,
      prefix: "app-backend",
      tail: 0,
      onLine: () => {
        throw new Error("oversized data must not be emitted");
      },
      onError: (code) => {
        errors.push(code);
      },
    });

    try {
      await tail.ready;

      appendFileSync(file, "x".repeat(LOG_TAIL_LIMITS.readBytes + 1));

      for (let tick = 0; tick < 150 && !tail.closed; tick++) {
        await vi.advanceTimersByTimeAsync(LOG_TAIL_LIMITS.pollMs);

        await setTimeout(10); // Native file I/O remains real; only the poll clock advances.
      }

      expect(tail.closed).toBe(true);
      expect(errors).toEqual(["LOG_READ_LIMIT"]);
    } finally {
      tail.close();

      vi.useRealTimers();
    }
  }));
