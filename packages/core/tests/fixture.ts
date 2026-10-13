import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { onTestFinished } from "vitest";
import { boot, type BootHandle, type BootOptions } from "../src/boot/boot.ts";

export async function fixture(files: Record<string, string> = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "tulipes-test-"));
  const handles: BootHandle[] = [];

  await linkWorkspace(join(rootDir, "node_modules"));

  const write = async (file: string, contents: string) => {
    const path = join(rootDir, file);

    await mkdir(dirname(path), { recursive: true });

    await writeFile(path, contents);
  };

  // Every fixture has a probe module, so a test may drop a single file into
  // it without writing a manifest.
  const provided: Record<string, string> = {
    "package.json": '{"type":"module"}',
    "modules/probe/package.json": JSON.stringify({ name: "@test/probe", type: "module" }),
    ...files,
  };
  for (const [file, contents] of Object.entries(provided)) await write(file, contents);

  // onTestFinished, not afterEach: fixture() is called from inside a test, and
  // a hook registered there never runs — every fixture leaked its temp
  // directory, thousands of them over a day of test runs.
  onTestFinished(async () => {
    await Promise.allSettled(handles.map((handle) => handle.shutdown()));

    await rm(rootDir, { recursive: true, force: true });
  });

  return {
    rootDir,
    write,
    async boot(options: Omit<BootOptions, "rootDir"> = {}) {
      // An ephemeral port, so a backend boot never takes a real one.
      const handle = await boot({
        rootDir,
        appEnv: "production",
        port: 0,
        handleSignals: false,
        ...options,
      });

      handles.push(handle);

      return handle;
    },
  };
}

/**
 * A fixture app resolves packages the way a flat install would. pnpm keeps
 * the workspace in two layers: the root's own direct dependencies at
 * node_modules, and everything else (every workspace package and transitive
 * dependency, linked once) in the virtual store's hoisted directory. The
 * fixture links both into one flat directory, scope by scope, root last so a
 * root dependency wins where both layers carry a name.
 */
async function linkWorkspace(target: string): Promise<void> {
  const layers = [resolve("node_modules/.pnpm/node_modules"), resolve("node_modules")].filter((layer) => existsSync(layer));

  const link = (from: string, to: string) =>
    symlink(from, to, "dir").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });

  await mkdir(target, { recursive: true });

  for (const layer of layers) {
    for (const entry of await readdir(layer)) {
      if (entry.startsWith(".")) continue;

      if (!entry.startsWith("@")) {
        await link(join(layer, entry), join(target, entry));
        continue;
      }

      await mkdir(join(target, entry), { recursive: true });

      for (const inner of await readdir(join(layer, entry))) {
        await link(join(layer, entry, inner), join(target, entry, inner));
      }
    }
  }
}

export function url(handle: BootHandle): string {
  const address = handle.server?.address();

  if (!address || typeof address === "string")
    throw new Error("server is not listening");

  return `http://127.0.0.1:${address.port}`;
}
