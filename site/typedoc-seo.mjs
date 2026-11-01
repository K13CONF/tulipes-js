// TypeDoc plugin: gives every generated API page a title and description that pass the
// site's frontmatter schema (title ≤ 50, description 120–160) and say which import it is.
import { PageEvent, ReflectionKind } from "typedoc";

const SUFFIX = " Signature, parameters, types and source in the Tulipes API reference.";

function moduleOf(model) {
  let node = model;
  while (node && !node.kindOf(ReflectionKind.Module) && !node.kindOf(ReflectionKind.Project)) node = node.parent;
  return node;
}

// Entry file → import specifier ("@tulipes/core/acl"), set by astro.config.mjs from each package's exports.
const importPaths = JSON.parse(process.env.TULIPES_IMPORT_PATHS ?? "{}");
const importPathOf = (model, pkg) => importPaths[moduleOf(model)?.sources?.[0]?.fullFileName] ?? pkg;

function summaryOf(model) {
  const comment = model.comment ?? model.signatures?.[0]?.comment ?? model.type?.declaration?.signatures?.[0]?.comment;
  return (comment?.summary ?? [])
    .map(part => part.text)
    .join("")
    .replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function describe(lead, summary, suffix = SUFFIX) {
  const text = summary ? `${lead}: ${summary.replace(/\.$/, "")}.` : `${lead}.`;
  if (text.length >= 120 && text.length <= 160) return text;
  // Shortest-to-fit: the first suffix that lands the description inside 120–160 characters.
  for (const extra of [suffix, " Generated from the source on every build.", " Part of the Tulipes reference.", " Tulipes reference."]) {
    if (text.length + extra.length >= 120 && text.length + extra.length <= 160) return text + extra;
  }
  let padded = text;
  for (const extra of [suffix, " Generated from the source on every build."]) if (padded.length < 120) padded += extra;
  return padded.length <= 160 ? padded : padded.slice(0, 159).replace(/\s+\S*$/, "") + "…";
}

// Self-check, run with `node typedoc-seo.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { strictEqual, ok } = await import("node:assert");
  for (const [lead, summary] of [["Function x from @tulipes/core", ""], ["Class A from @tulipes/core", "a ".repeat(100)], ["The tulipes migrate command of the Tulipes CLI", "rewrite an app generated on 0.10 to the 0.11 layout and contracts"]]) {
    const d = describe(lead, summary);
    ok(d.length >= 120 && d.length <= 160, `${d.length}: ${d}`);
  }
  strictEqual(describe("x", "y".repeat(130)), `x: ${"y".repeat(130)}.`);
  console.log("describe: ok");
}

export function load(app) {
  // starlight-typedoc writes `title: "<name>"` frontmatter at PageEvent.END (priority 0);
  // this runs after it (-100) and replaces the block with a qualified title and a description.
  app.renderer.on(PageEvent.END, event => {
    if (!event.contents?.startsWith("---\n")) return;
    const pkg = app.options.getValue("name");
    const model = event.model;
    const isModule = model.kindOf(ReflectionKind.Module) || model.kindOf(ReflectionKind.Project);
    const from = importPathOf(model, pkg);
    const lead = isModule ? `Module ${from}` : `${ReflectionKind.singularString(model.kind)} ${model.name} from ${from}`;
    // The import path keeps generic names (provider, default, Envelope) unique across packages.
    const qualified = isModule ? `${from} API` : `${model.name} · ${from}`; // "API" keeps it apart from the package guide page
    const title = qualified.length <= 50 ? qualified : model.name.slice(0, 50);
    const end = event.contents.indexOf("\n---\n", 4);
    const kept = event.contents.slice(4, end).split("\n").filter(line => !/^(title|description):/.test(line));
    // Out of search: readers find guides first; the generated pages stay reachable from the sidebar.
    const fields = [...kept, `title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(describe(lead, summaryOf(model)))}`, "pagefind: false"];
    event.contents = `---\n${fields.join("\n")}${event.contents.slice(end)}`;
  }, -100);
}
