import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes one variable into an `.envs/.env.<APP_ENV>` file.
 *
 * Surgical on purpose: the file is read, the single matching line is
 * replaced in place, and everything else — comments, blank lines, ordering,
 * unrelated entries — is written back byte-for-byte. The scaffold's env
 * files are half explanation, and a naive `stringify(parse(file))` would
 * throw all of it away on the first save.
 */
export interface WriteResult {
  /** True when the file already carried this variable. */
  replaced: boolean;
}

export function writeVariable(file: string, name: string, value: string): WriteResult {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const rendered = `${name}=${quote(value)}`;

  // Matches `NAME=…`, optionally exported and indented, but never a line
  // where the name only appears inside a comment or another value.
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));

  if (index !== -1) {
    lines[index] = rendered;
    save(file, lines);
    return { replaced: true };
  }

  // Appended with a trailing newline preserved, so the next write finds a
  // clean last line rather than concatenating onto this one.
  if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  lines.splice(lines.length - 1, 0, rendered);
  save(file, lines);
  return { replaced: false };
}

/**
 * Quote only when the value would otherwise not survive a round trip —
 * whitespace, quotes, `#`, or an empty value. dotenv reads bare values
 * fine, and leaving them bare keeps hand-edited files readable.
 */
function quote(value: string): string {
  if (value === "" || /[\s"'#]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function save(file: string, lines: string[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join("\n"));
}
