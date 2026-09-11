import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { HttpError } from "@tulipes/core/http";

export const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;

const unsafe = () =>
  new HttpError(409, "settingsFileUnsafe", {
    code: "SETTINGS_FILE_UNSAFE",
    defaultMessage:
      "Settings files must be regular files in a real directory, without links",
  });

const tooLarge = () =>
  new HttpError(413, "settingsFileTooLarge", {
    code: "SETTINGS_FILE_TOO_LARGE",
    defaultMessage: "Settings file exceeds the allowed size",
  });

function guarded<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof HttpError) throw error;

    throw new HttpError(503, "settingsFileUnavailable", {
      code: "SETTINGS_FILE_UNAVAILABLE",
      defaultMessage: "The settings file operation could not be completed",
    });
  }
}

/** Ancestors above this configured directory must be trusted operator-owned paths. */
function directory(dir: string, create = false): boolean {
  let stat = lstatSync(dir, { throwIfNoEntry: false });
  if (!stat && create) {
    mkdirSync(dir, { mode: 0o700 });
    stat = lstatSync(dir);
  }
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe();
  return true;
}

/** Missing files are distinct from unsafe/unreadable files. No unbounded readFile. */
export function readSettingsFile(file: string): string | undefined {
  return guarded(() => {
    if (!directory(dirname(file))) return undefined;

    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return undefined;
    if (!stat.isFile() || stat.nlink !== 1) throw unsafe();

    const fd = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1) throw unsafe();
      if (opened.size > MAX_SETTINGS_FILE_BYTES) throw tooLarge();

      // One extra byte detects growth after fstat without allocating by file size.
      const buffer = Buffer.alloc(MAX_SETTINGS_FILE_BYTES + 1);
      let total = 0;

      while (total < buffer.length) {
        const count = readSync(fd, buffer, total, buffer.length - total, total);
        if (!count) break;
        total += count;
      }
      if (total > MAX_SETTINGS_FILE_BYTES) throw tooLarge();

      return buffer.toString("utf8", 0, total);
    } finally {
      closeSync(fd);
    }
  });
}

/** Replace within the same directory so failed writes leave the old file intact. */
export function writeSettingsFile(
  file: string,
  content: string,
  secret = false,
): void {
  guarded(() => {
    if (Buffer.byteLength(content) > MAX_SETTINGS_FILE_BYTES) throw tooLarge();
    directory(dirname(file), true);

    // Reject linked/special/oversized existing targets before creating a temp file.
    readSettingsFile(file);

    const stat = lstatSync(file, { throwIfNoEntry: false });
    const temporary = join(dirname(file), ".settings-" + randomUUID() + ".tmp");
    const fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    let open = true;
    try {
      writeFileSync(fd, content, "utf8");
      fchmodSync(fd, secret ? 0o600 : stat ? stat.mode & 0o777 : 0o600);
      fsyncSync(fd);
      closeSync(fd);
      open = false;

      // Commit only after the complete replacement has been flushed and closed.
      renameSync(temporary, file);
    } finally {
      if (open) closeSync(fd);

      try {
        unlinkSync(temporary);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          throw error;
      }
    }
  });
}

/** Bound directory scanning too; callers select only known locale filenames. */
export function settingsFileNames(dir: string): string[] {
  return guarded(() => {
    if (!directory(dir)) return [];

    const handle = opendirSync(dir);
    try {
      const names: string[] = [];
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        if (names.length >= 256) throw tooLarge();
        names.push(entry.name);
      }
      return names;
    } finally {
      handle.closeSync();
    }
  });
}

/** Bound JSON depth and traversal work before flattening or serializing it. */
export function settingsJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "settingsJsonInvalid", {
      code: "SETTINGS_JSON_INVALID",
      defaultMessage: "Translations must be a JSON object",
    });
  }
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;

  while (pending.length) {
    const entry = pending.pop()!;
    if (++nodes > 10_000 || entry.depth > 64) throw tooLarge();
    if (entry.value && typeof entry.value === "object") {
      for (const child of Object.values(entry.value)) {
        if (pending.length >= 10_000) throw tooLarge();
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }

  return value as Record<string, unknown>;
}

export function readSettingsJson(file: string): Record<string, unknown> {
  const content = readSettingsFile(file);
  if (content === undefined)
    throw new HttpError(404, "noSuchLocale", { field: "locale" });

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new HttpError(422, "settingsJsonInvalid", {
      code: "SETTINGS_JSON_INVALID",
      defaultMessage: "The translations file contains invalid JSON",
    });
  }

  return settingsJson(value);
}

/** Bound expanded key paths as well as the source JSON that produced them. */
export function missingTranslationKeys(
  source: Record<string, unknown>,
): string[] {
  const keys: string[] = [];
  let bytes = 0;

  function visit(value: Record<string, unknown>, prefix: string): void {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? prefix + "." + key : key;
      if (Buffer.byteLength(path) > 4096) throw tooLarge();
      if (child && typeof child === "object" && !Array.isArray(child)) {
        visit(child as Record<string, unknown>, path);
      } else {
        bytes += Buffer.byteLength(path);
        if (bytes > MAX_SETTINGS_FILE_BYTES || keys.length >= 10_000)
          throw tooLarge();
        keys.push(path);
      }
    }
  }

  visit(settingsJson(source), "");
  return keys;
}
