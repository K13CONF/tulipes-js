// Runs from `prepack`, after the build: copies the reference application into
// templates/app and records the workspace versions, so the published CLI
// scaffolds exactly the app the repository develops against. Both outputs are
// git-ignored; a source checkout reads example/ and packages/*/package.json
// directly (see src/template.ts).
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { isTemplateDir, isTemplateFile, readVersions } = await import(join(cli, "dist", "template.js"));

const example = resolve(cli, "..", "..", "example");
const target = join(cli, "templates", "app");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(example, target, {
  recursive: true,
  filter: (source) => {
    const rel = relative(example, source).split(sep).join("/");
    if (rel === "") return true;
    return statSync(source).isDirectory() ? isTemplateDir(basename(source)) : isTemplateFile(rel);
  },
});

const versions = readVersions();
for (const name of ["pnpm", "@tulipes/core", "@tulipes/cli", "@tulipes/spec", "@tulipes/mongoose", "@tulipes/bullmq", "@tulipes/socket.io", "@tulipes/testing"]) {
  if (!versions[name]) throw new Error(`pack-templates: missing workspace version for ${name}`);
}
writeFileSync(join(cli, "templates", "versions.json"), JSON.stringify(versions, null, 2) + "\n");

const packed = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
console.log(`packed templates/app from ${relative(cli, example)} (${packed.name}) with ${Object.keys(versions).length} versions`);
