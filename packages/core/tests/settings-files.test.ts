import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { expect, test, vi } from "vitest";
import { missingTranslationKeys, readSettingsFile, writeSettingsFile, readSettingsJson, settingsFileNames, settingsJson } from "../../../example/modules/settings/helpers/files.js";
import { writeVariable } from "../../../example/modules/settings/helpers/env-file.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), openSync: vi.fn(actual.openSync), fstatSync: vi.fn(actual.fstatSync) };
});

function fixture(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "tulipes-settings-files-"));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test.each(["symlink", "hardlink"])("environment writes reject %s targets without changing the target", kind => fixture(dir => {
  const target = join(dir, "target");
  const file = join(dir, ".env.test");
  writeFileSync(target, "SECRET=original\n");
  if (kind === "symlink") symlinkSync(target, file);
  else linkSync(target, file);
  expect(() => writeVariable(file, "SECRET", "changed")).toThrow();
  expect(readFileSync(target, "utf8")).toBe("SECRET=original\n");
}));

test("oversized environment files are refused without modifying them", () => fixture(dir => {
  const file = join(dir, ".env.test");
  const original = "#".repeat(1024 * 1024 + 1);
  writeFileSync(file, original);
  expect(() => writeVariable(file, "SECRET", "changed")).toThrow();
  expect(readFileSync(file, "utf8")).toBe(original);
}));

test.each(['C:\\new\\path', 'a"b', "has # and ' quote", "line one\nline two"])("a written value survives dotenv parsing exactly: %j", value => fixture(dir => {
  const file = join(dir, ".env.test");
  writeFileSync(file, "# keep this comment\nOTHER=unchanged\nSECRET=old\n");
  writeVariable(file, "SECRET", value);
  expect(parse(readFileSync(file))).toEqual({ OTHER: "unchanged", SECRET: value });
  expect(readFileSync(file, "utf8")).toContain("# keep this comment\n");
}));

test("duplicate assignments cannot silently keep the old effective value", () => fixture(dir => {
  const file = join(dir, ".env.test");
  writeFileSync(file, "SECRET=first\nSECRET=last\n");
  const before = readFileSync(file, "utf8");
  try { writeVariable(file, "SECRET", "new"); }
  catch { expect(readFileSync(file, "utf8")).toBe(before); return; }
  expect(parse(readFileSync(file)).SECRET).toBe("new");
}));


test("linked parent directories are rejected for both reads and writes", () => fixture(dir => {
  const parent = join(dir, "linked");
  symlinkSync(dir, parent);
  writeFileSync(join(dir, "en.json"), "{}");
  expect(() => readSettingsFile(join(parent, "en.json"))).toThrow();
  expect(() => writeSettingsFile(join(parent, "en.json"), "changed")).toThrow();
  expect(() => settingsFileNames(parent)).toThrow();
  expect(readFileSync(join(dir, "en.json"), "utf8")).toBe("{}");
}));

test("special files cannot block settings reads", () => fixture(dir => {
  const file = join(dir, "fifo");
  execFileSync("mkfifo", [file]);
  expect(() => readSettingsFile(file)).toThrow();
  expect(() => writeSettingsFile(file, "changed")).toThrow();
}));

test("failed atomic replacement preserves contents and removes temporary files", () => fixture(dir => {
  const file = join(dir, "en.json");
  writeFileSync(file, '{"old":true}');
  const spy = vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error("private path canary"); });
  try {
    expect(() => writeSettingsFile(file, '{"new":true}')).toThrow("settingsFileUnavailable");
    expect(readFileSync(file, "utf8")).toBe('{"old":true}');
    expect(fs.readdirSync(dir)).toEqual(["en.json"]);
  } finally { spy.mockRestore(); }
}));

test("environment files are created privately and existing permissive modes are tightened", () => fixture(dir => {
  const file = join(dir, ".env.test");
  writeVariable(file, "SECRET", "first");
  expect(parse(readFileSync(file))).toEqual({ SECRET: "first" });
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  fs.chmodSync(file, 0o644);
  writeVariable(file, "SECRET", "second");
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
}));

test("output size and directory entries have independent bounds", () => fixture(dir => {
  const file = join(dir, "en.json");
  expect(() => writeSettingsFile(file, "x".repeat(1024 * 1024 + 1))).toThrow();
  expect(fs.existsSync(file)).toBe(false);
  for (let i = 0; i < 257; i++) writeFileSync(join(dir, String(i)), "");
  expect(() => settingsFileNames(dir)).toThrow();
}));

test("JSON reads distinguish missing, invalid, deeply nested and oversized files", () => fixture(dir => {
  const file = join(dir, "en.json");
  expect(() => readSettingsJson(file)).toThrow("noSuchLocale");
  for (const value of ["null", "[]", "{invalid"]) {
    writeFileSync(file, value);
    expect(() => readSettingsJson(file)).toThrow();
  }
  writeFileSync(file, '{"x":'.repeat(66) + '0' + '}'.repeat(66));
  expect(() => readSettingsJson(file)).toThrow();
  writeFileSync(file, " ".repeat(1024 * 1024 + 1));
  expect(() => readSettingsJson(file)).toThrow();
  writeFileSync(file, '{"ok":"value"}');
  expect(readSettingsJson(file)).toEqual({ ok: "value" });
  expect(() => settingsJson({ entries: Array(10_001).fill(0) })).toThrow();
}));

test("multiline or embedded assignments cannot change unrelated effective values", () => fixture(dir => {
  const file = join(dir, ".env.test");
  for (const original of ["SECRET='line one\nline two'\nOTHER=keep\n", "OTHER='line\nSECRET=fake\nend'\nSECRET=actual\n"]) {
    writeFileSync(file, original);
    expect(() => writeVariable(file, "SECRET", "new")).toThrow();
    expect(readFileSync(file, "utf8")).toBe(original);
  }
}));


test("missing-key expansion is bounded independently of source JSON size", () => {
  expect(missingTranslationKeys({ nested: { key: "missing" }, list: [1, 2] })).toEqual(["nested.key", "list"]);
  expect(() => missingTranslationKeys({ ["x".repeat(4097)]: "missing" })).toThrow();
  expect(() => missingTranslationKeys({ ["x".repeat(4000)]: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [String(i), ""])) })).toThrow();
});


test("a leaf swapped to a symlink between inspection and open is never followed", () => fixture(dir => {
  const file = join(dir, "en.json");
  const outside = join(dir, "outside.json");
  writeFileSync(file, "{}");
  writeFileSync(outside, '{"secret":"canary"}');
  const open = vi.mocked(fs.openSync).getMockImplementation()!;
  vi.mocked(fs.openSync).mockImplementationOnce((path, flags, mode) => {
    fs.unlinkSync(file);
    symlinkSync(outside, file);
    return open(path, flags, mode);
  });
  expect(() => readSettingsFile(file)).toThrow("settingsFileUnavailable");
}));

test("growth after descriptor inspection cannot exceed the read byte ceiling", () => fixture(dir => {
  const file = join(dir, "en.json");
  writeFileSync(file, "{}");
  const stat = vi.mocked(fs.fstatSync).getMockImplementation()!;
  vi.mocked(fs.fstatSync).mockImplementationOnce((fd, options) => {
    const result = stat(fd, options);
    writeFileSync(file, "x".repeat(1024 * 1024 + 1));
    return result;
  });
  expect(() => readSettingsFile(file)).toThrow("settingsFileTooLarge");
}));
