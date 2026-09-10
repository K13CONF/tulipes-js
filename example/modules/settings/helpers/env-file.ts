import { parse } from "dotenv";
import { HttpError } from "@tulipes/core/http";
import { readSettingsFile, writeSettingsFile } from "./files.js";

export interface WriteResult { replaced: boolean }

const unsupported = () => new HttpError(422, "envFileUnsupported", {
  code: "ENV_FILE_UNSUPPORTED",
  defaultMessage: "The value or existing env assignment cannot be safely edited; normalize it manually",
});

/** Preserve unrelated lines and verify the effective dotenv values before writing. */
export function writeVariable(file: string, name: string, value: string): WriteResult {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /[\r\0]/.test(value)) throw unsupported();
  const original = readSettingsFile(file) ?? "";
  const before = parse(original);
  // dotenv does not implement JSON/shell quote escaping. Choose only a spelling
  // its actual parser can read back exactly, without introducing another key.
  const rendered = [value, "'" + value + "'", '"' + value + '"', "`" + value + "`"]
    .map(candidate => name + "=" + candidate)
    .find(candidate => {
      const parsed = parse(candidate);
      return Object.keys(parsed).length === 1 && parsed[name] === value;
    });
  if (!rendered) throw unsupported();
  const lines = original.split("\n");
  const pattern = new RegExp("^\\s*(?:export\\s+)?" + name + "\\s*=");
  const matches = lines.flatMap((line, index) => pattern.test(line) ? [index] : []);
  if (matches.length > 1) throw unsupported();
  const index = matches[0];
  if (index !== undefined) {
    // Multiline existing assignments need a human edit; never leave their tail
    // behind or treat a matching line inside another quoted value as a key.
    if (parse(lines[index]!)[name] !== before[name]) throw unsupported();
    lines[index] = rendered;
  } else {
    if (lines.at(-1) !== "") lines.push("");
    lines.splice(lines.length - 1, 0, rendered);
  }
  const content = lines.join("\n");
  const expected = { ...before, [name]: value };
  const actual = parse(content);
  if (Object.keys(actual).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, entry]) => actual[key] !== entry)) throw unsupported();
  writeSettingsFile(file, content, true);
  return { replaced: index !== undefined };
}
