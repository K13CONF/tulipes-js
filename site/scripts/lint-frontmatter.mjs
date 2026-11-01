// Fast check of hand-written pages without a full build: frontmatter lengths, uniqueness,
// links carrying the base path. Usage: node site/scripts/lint-frontmatter.mjs [files…] (default: all).
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const docs = fileURLToPath(new URL("../src/content/docs/", import.meta.url));
const generated = /^reference\/(api|cli)\//;
const all = readdirSync(docs, { recursive: true })
  .filter(f => /\.mdx?$/.test(f) && !generated.test(f))
  .map(f => join(docs, f));
const targets = process.argv.length > 2 ? process.argv.slice(2).map(f => f.startsWith("/") ? f : join(process.cwd(), f)) : all;

const field = (text, name) => text.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
const seen = { title: new Map(), description: new Map() };
for (const file of all) {
  const text = readFileSync(file, "utf8");
  for (const key of ["title", "description"]) {
    const value = field(text.split(/^---$/m)[1] ?? "", key);
    if (value) seen[key].set(value, [...(seen[key].get(value) ?? []), relative(docs, file)]);
  }
}

const problems = [];
for (const file of targets) {
  const page = relative(docs, file);
  const text = readFileSync(file, "utf8");
  const front = text.split(/^---$/m)[1];
  if (!front) { problems.push(`${page}: no frontmatter`); continue; }
  for (const [, key, value] of front.matchAll(/^(title|description): (.*)$/gm)) {
    if (!/^["']/.test(value) && /: | #/.test(value)) problems.push(`${page}: quote the ${key}; ": " or " #" breaks unquoted YAML`);
  }
  const title = field(front, "title");
  const description = field(front, "description");
  if (!title || title.length > 50) problems.push(`${page}: title must be 1–50 characters (is ${title?.length ?? 0})`);
  if (!description || description.length < 120 || description.length > 160) problems.push(`${page}: description must be 120–160 characters (is ${description?.length ?? 0})`);
  for (const [key, value] of [["title", title], ["description", description]]) {
    const owners = seen[key].get(value) ?? [];
    if (owners.length > 1) problems.push(`${page}: ${key} also used by ${owners.filter(o => o !== page).join(", ")}`);
  }
  for (const [, href] of text.matchAll(/(?:\]\(|href=")(\/[^)"\s#]*)/g)) {
    if (!href.startsWith("/tulipes-js/")) problems.push(`${page}: internal link ${href} lacks the /tulipes-js base`);
    else if (!/\/$|\.[a-z]+$/.test(href)) problems.push(`${page}: internal link ${href} needs a trailing slash`);
  }
  const prose = text.slice(text.indexOf("---", 3) + 3).replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
  if (/^#\s/m.test(prose)) problems.push(`${page}: body has an h1; start at ##`);
}

if (problems.length) {
  console.error(problems.map(p => `✖ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`frontmatter ok: ${targets.length} file(s)`);
