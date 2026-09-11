import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, vi } from "vitest";
import { boot, type BootHandle, type BootOptions } from "../src/boot/boot.js";

export async function fixture(files: Record<string, string> = {}) {
  vi.stubEnv("PORT", "0");

  const rootDir = await mkdtemp(join(tmpdir(), "tulipes-test-"));
  const handles: BootHandle[] = [];

  await symlink(resolve("node_modules"), join(rootDir, "node_modules"), "dir");

  const write = async (file: string, contents: string) => {
    const path = join(rootDir, file);

    await mkdir(dirname(path), { recursive: true });

    await writeFile(path, contents);
  };

  for (const [file, contents] of Object.entries({
    "package.json": '{"type":"module"}',
    "modules/probe/package.json": '{"name":"@test/probe","type":"module"}',
    "modules/probe/meta.variables.json": JSON.stringify({
      variables: [
        {
          name: "PORT",
          type: "number",
          default: 0,
          description: "Ephemeral HTTP port",
        },
      ],
    }),
    ...files,
  }))
    await write(file, contents);

  afterEach(async () => {
    await Promise.allSettled(handles.map((handle) => handle.shutdown()));

    await rm(rootDir, { recursive: true, force: true });
  });

  return {
    rootDir,
    write,
    async boot(options: Omit<BootOptions, "rootDir"> = {}) {
      const handle = await boot({
        rootDir,
        appEnv: "production",
        handleSignals: false,
        ...options,
      });

      handles.push(handle);

      return handle;
    },
  };
}

export function url(handle: BootHandle): string {
  const address = handle.server?.address();

  if (!address || typeof address === "string")
    throw new Error("server is not listening");

  return `http://127.0.0.1:${address.port}`;
}
