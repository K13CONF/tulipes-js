// Checks the built site for the SEO floor in plan §4: one h1, a canonical URL,
// a unique title and description on every page, and a sitemap. Run after `astro build`.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const pages = readdirSync(dist, { recursive: true })
  .filter(file => file.endsWith(".html"))
  .map(file => join(dist, file));

const problems = [];
const seen = { title: new Map(), description: new Map() };
const pick = (html, re) => html.match(re)?.[1];

for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const page = relative(dist, file);
  if (page === "404.html") continue; // not indexed; Starlight marks it noindex
  const title = pick(html, /<title>([^<]*)<\/title>/);
  const description = pick(html, /<meta name="description" content="([^"]*)"/);
  if (!pick(html, /<link rel="canonical" href="(https:[^"]+)"/)) problems.push(`${page}: no absolute canonical URL`);
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) problems.push(`${page}: needs exactly one h1`);
  if (!/<html[^>]* lang="en"/.test(html)) problems.push(`${page}: <html lang="en"> missing`);
  for (const [key, value] of [["title", title], ["description", description]]) {
    if (!value) { problems.push(`${page}: no ${key}`); continue; }
    if (seen[key].has(value)) problems.push(`${page}: ${key} duplicates ${seen[key].get(value)}`);
    seen[key].set(value, page);
  }
  if (title && title.length > 60) problems.push(`${page}: title is ${title.length} characters (max 60)`);
}

if (!existsSync(join(dist, "sitemap-index.xml"))) problems.push("sitemap-index.xml missing");
if (!existsSync(join(dist, "404.html"))) problems.push("404.html missing");

if (problems.length) {
  console.error(`Site check failed — ${problems.length} issue(s):\n` + problems.map(p => `  ✖ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Site check passed: ${pages.length} page(s).`);
