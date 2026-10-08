import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../src/package-info.ts", async (original) => ({
  ...(await original<typeof import("../src/package-info.ts")>()),
  packageRoot: vi.fn(),
  cliVersion: vi.fn(),
}));

const { spawn } = await import("node:child_process");
const info = await import("../src/package-info.ts");
const { compareVersions, detectManager, runUpdate } = await import("../src/update.ts");

/**
 * `tulipes update` against a registry stub and a spawn stub: no network,
 * no package manager. What is asserted is what the command does to the
 * app's manifests and which install it would start.
 */
let root: string;
let logs: string[];
let errors: string[];

function app(files: Record<string, unknown>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
  }
}

const manifest = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

/** `latest` per package, by the name after `@tulipes/`; an unlisted package is a 404. */
function registry(versions: Record<string, string> | Error): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (versions instanceof Error) throw versions;
    const version = versions[/%2f([^/]+)\/latest$/.exec(url)![1]!];
    return version ? { ok: true, json: async () => ({ version }) } : { ok: false, status: 404 };
  }));
}

/** The next spawn exits with `code`, or fails to start when `code` is "error". */
function installExits(code: number | "error"): void {
  vi.mocked(spawn).mockImplementation((() => {
    const child = new EventEmitter();
    queueMicrotask(() => (code === "error" ? child.emit("error", new Error("ENOENT")) : child.emit("exit", code)));
    return child;
  }) as never);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tulipes-update-"));
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
  // A source checkout by default: not a global install, so only the app is updated.
  vi.mocked(info.packageRoot).mockReturnValue(join(root, "..", "checkout", "packages", "cli"));
  vi.mocked(info.cliVersion).mockReturnValue("0.2.0-rc.1");
  vi.mocked(spawn).mockReset();
  installExits(0);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

test("versions order by semver precedence, prereleases before their release", () => {
  const ordered = ["0.9.3", "0.10.1", "0.11.0-rc.1", "0.11.0-rc.2", "0.11.0-rc.10", "0.11.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0"];
  for (let i = 1; i < ordered.length; i++) {
    expect(compareVersions(ordered[i - 1]!, ordered[i]!), `${ordered[i - 1]} < ${ordered[i]}`).toBe(-1);
    expect(compareVersions(ordered[i]!, ordered[i - 1]!)).toBe(1);
  }
  expect(compareVersions("0.11.0-rc.1", "0.11.0-rc.1")).toBe(0);
  expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
});

test("an app on a candidate ahead of latest is left alone — never downgraded", async () => {
  app({
    "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.11.0-rc.1" }, devDependencies: { "@tulipes/cli": "^0.2.0-rc.1" } },
    "modules/users/package.json": { name: "@app/users", dependencies: { "@tulipes/core": "^0.11.0-rc.1" } },
    "node_modules/@tulipes/core/package.json": { name: "@tulipes/core", version: "0.11.0-rc.1" },
    "pnpm-lock.yaml": "",
  });
  registry({ core: "0.10.1", cli: "0.1.1" });
  const before = [manifest("package.json"), manifest("modules/users/package.json")];

  await runUpdate(root);

  expect([manifest("package.json"), manifest("modules/users/package.json")]).toEqual(before);
  expect(spawn).not.toHaveBeenCalled();
  expect(logs).toContain("app already at or ahead of @tulipes/core@0.10.1 (installed 0.11.0-rc.1)");
  expect(process.exitCode).toBeUndefined();
});

test("an app behind latest is raised in the root and every module, then installed with its manager", async () => {
  app({
    "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.10.0", express: "^5" }, devDependencies: { "@tulipes/cli": "^0.1.0" } },
    "modules/users/package.json": { name: "@app/users", dependencies: { "@tulipes/core": "^0.10.0" } },
    "modules/hello/package.json": { name: "@app/hello", devDependencies: { "@tulipes/core": "~0.10.0" } },
    "modules/local/package.json": { name: "@app/local", dependencies: { "@tulipes/core": "workspace:*" } },
    "modules/plain/package.json": { name: "@app/plain", dependencies: { zod: "^3" } },
    "modules/notes.txt": "not a module",
    "node_modules/@tulipes/core/package.json": { name: "@tulipes/core", version: "0.10.0" },
    "pnpm-lock.yaml": "",
  });
  registry({ core: "0.10.1", cli: "0.1.1" });

  await runUpdate(root);

  expect(manifest("package.json")).toEqual({ name: "app", dependencies: { "@tulipes/core": "^0.10.1", express: "^5" }, devDependencies: { "@tulipes/cli": "^0.1.1" } });
  expect(manifest("modules/users/package.json").dependencies["@tulipes/core"]).toBe("^0.10.1");
  expect(manifest("modules/hello/package.json").devDependencies["@tulipes/core"]).toBe("^0.10.1");
  expect(manifest("modules/local/package.json").dependencies["@tulipes/core"]).toBe("workspace:*");
  expect(manifest("modules/plain/package.json")).toEqual({ name: "@app/plain", dependencies: { zod: "^3" } });
  expect(spawn).toHaveBeenCalledOnce();
  expect(spawn).toHaveBeenCalledWith("pnpm", ["install"], expect.objectContaining({ cwd: root }));
  expect(logs.filter((line) => line.startsWith("  update package.json:"))).toHaveLength(1);
  expect(logs).toContain("\napp: 0.10.0 → 0.10.1\n");
  // Same minor: no migration warning.
  expect(logs.join("\n")).not.toContain("MIGRATING.md");
});

test("the providers, spec and testing move to the line paired with the new core", async () => {
  app({
    "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.10.1", "@tulipes/mongoose": "^0.1.1", "@tulipes/bullmq": "^0.1.1" },
      devDependencies: { "@tulipes/cli": "^0.1.1", "@tulipes/spec": "^0.3.1", "@tulipes/testing": "workspace:*" } },
    "modules/users/package.json": { name: "@app/users", dependencies: { "@tulipes/core": "^0.10.1", "@tulipes/socket.io": "^0.1.1" } },
    "node_modules/@tulipes/core/package.json": { name: "@tulipes/core", version: "0.10.1" },
  });
  registry({ core: "0.11.0", cli: "0.2.0", mongoose: "0.2.0", bullmq: "0.2.0", "socket.io": "0.1.2", spec: "0.3.2", testing: "0.1.0" });

  await runUpdate(root);

  expect(manifest("package.json")).toEqual({ name: "app",
    dependencies: { "@tulipes/core": "^0.11.0", "@tulipes/mongoose": "^0.2.0", "@tulipes/bullmq": "^0.2.0" },
    devDependencies: { "@tulipes/cli": "^0.2.0", "@tulipes/spec": "^0.3.2", "@tulipes/testing": "workspace:*" } });
  expect(manifest("modules/users/package.json").dependencies).toEqual({ "@tulipes/core": "^0.11.0", "@tulipes/socket.io": "^0.1.2" });
  expect(logs).toContain("  update modules/users/package.json: @tulipes/core ^0.11.0, @tulipes/socket.io ^0.1.2");
  // Undeclared packages are never looked up.
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter((url) => /mcp/.test(url))).toEqual([]);
});

test("a package the registry cannot answer for changes nothing", async () => {
  app({ "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.10.0", "@tulipes/mongoose": "^0.1.0" } } });
  registry({ core: "0.10.1", cli: "0.1.1" });

  await runUpdate(root);

  expect(manifest("package.json").dependencies).toEqual({ "@tulipes/core": "^0.10.0", "@tulipes/mongoose": "^0.1.0" });
  expect(spawn).not.toHaveBeenCalled();
  expect(errors).toEqual(["could not reach the npm registry: @tulipes/mongoose: registry responded 404"]);
  expect(process.exitCode).toBe(1);
});

test("crossing a minor points at the migration guide for the new version", async () => {
  app({
    "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.9.3" } },
    "node_modules/@tulipes/core/package.json": { name: "@tulipes/core", version: "0.9.3" },
  });
  registry({ core: "0.11.0", cli: "0.2.0" });

  await runUpdate(root);

  const output = logs.join("\n");
  expect(output).toContain("This crossed 2 minor version(s)");
  expect(output).toContain("/blob/v0.11.0/packages/core/MIGRATING.md");
});

test("a failed install keeps its exit code; a manager that cannot start says the manifests are already updated", async () => {
  app({ "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.10.0" } }, "package-lock.json": "{}" });
  registry({ core: "0.10.1", cli: "0.1.1" });
  installExits(3);

  await runUpdate(root);
  expect(spawn).toHaveBeenCalledWith("npm", ["install"], expect.anything());
  expect(process.exitCode).toBe(3);

  process.exitCode = undefined;
  app({ "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.10.0" } } });
  installExits("error");
  await runUpdate(root);
  expect(process.exitCode).toBe(1);
  expect(errors.at(-1)).toContain("manifests are updated, install manually");
});

test("an unreachable registry changes nothing and fails", async () => {
  app({ "package.json": { name: "app", dependencies: { "@tulipes/core": "^0.10.0" } } });
  registry(new Error("getaddrinfo ENOTFOUND"));

  await runUpdate(root);

  expect(manifest("package.json").dependencies["@tulipes/core"]).toBe("^0.10.0");
  expect(spawn).not.toHaveBeenCalled();
  expect(errors).toEqual(["could not reach the npm registry: getaddrinfo ENOTFOUND"]);
  expect(process.exitCode).toBe(1);
});

test("outside an app, a CLI that is not a global install refuses", async () => {
  registry({ core: "0.10.1", cli: "0.1.1" });

  await runUpdate(root);

  expect(errors[0]).toContain("run it from an app root");
  expect(process.exitCode).toBe(1);
});

test("a global CLI is reinstalled into its own prefix when behind, and never downgraded from a candidate", async () => {
  const prefix = join(root, "..", "node-prefix");
  vi.mocked(info.packageRoot).mockReturnValue(join(prefix, "lib", "node_modules", "@tulipes", "cli"));
  registry({ core: "0.10.1", cli: "0.1.1" });

  vi.mocked(info.cliVersion).mockReturnValue("0.2.0-rc.1");
  await runUpdate(root);
  expect(spawn).not.toHaveBeenCalled();
  expect(logs).toContain("cli already on 0.2.0-rc.1 (latest is 0.1.1)");

  vi.mocked(info.cliVersion).mockReturnValue("0.1.0");
  await runUpdate(root);
  expect(spawn).toHaveBeenCalledWith("npm", ["install", "-g", "--prefix", prefix, "@tulipes/cli@0.1.1"], expect.anything());
  expect(process.exitCode).toBeUndefined();
});

test("the manager comes from the lockfile, then the pinned packageManager, then pnpm", () => {
  app({ "package.json": { name: "app" } });
  expect(detectManager(root)).toBe("pnpm");
  app({ "package.json": { name: "app", packageManager: "yarn@4.18.0" } });
  expect(detectManager(root)).toBe("yarn");
  app({ "package.json": { name: "app", packageManager: "npm@11.0.0" } });
  expect(detectManager(root)).toBe("npm");
  app({ "pnpm-lock.yaml": "" });
  expect(detectManager(root)).toBe("pnpm");
  app({ "yarn.lock": "" });
  expect(detectManager(root)).toBe("yarn");
});
