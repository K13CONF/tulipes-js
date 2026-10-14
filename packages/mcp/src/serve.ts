import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AgentTool, ToolActor } from "@tulipes/core/agent";
import { boot, type BootHandle, type RuntimeCtx } from "@tulipes/core/boot";
import { ANONYMOUS, GUEST_ROLE, HttpError } from "@tulipes/core/http";

import { createServer, type ToolOutcome, type ToolSource } from "./server.ts";

/**
 * Who is calling, from the credential the client presented: an actor, or
 * null for a guest. For stdio the credential is `--token` or
 * `TULIPES_MCP_TOKEN`; it is resolved again on every list and call, so a
 * revocation or a role change applies to a running session.
 */
export type McpIdentify = (ctx: RuntimeCtx, credential: string | undefined) => ToolActor | null | Promise<ToolActor | null>;

export interface McpConfig {
  /** Only "stdio" in this release; Streamable HTTP is 0.13-S03.3. */
  transport?: "stdio";
  /** Without one, every caller is a guest. */
  identify?: McpIdentify;
}

/** `config/mcp.config.ts`'s default export. */
export function defineMcp(config: McpConfig): McpConfig {
  return config;
}

const DEVELOPMENT = Symbol("tulipes.mcp.developmentIdentity");

/**
 * A role read from an environment variable instead of from a credential:
 * convenient on a laptop, and refused when APP_ENV is production or staging.
 * Unset, the caller is a guest.
 */
export function developmentIdentity(variable = "MCP_ROLE"): McpIdentify {
  const identify: McpIdentify = () => {
    const role = process.env[variable];
    return role ? { ...ANONYMOUS, isAuthenticated: true, role } : null;
  };
  return Object.assign(identify, { [DEVELOPMENT]: variable });
}

export interface ServeMcpOptions {
  /** App root — the directory holding `modules/` and `config/`. */
  rootDir: string;
  /** Defaults to process.argv.slice(2); reads `--token <credential>`. */
  argv?: readonly string[];
  /** A transport other than stdio — the tests connect an in-memory one. */
  transport?: Transport;
  /** Where the audit lines go; stderr by default, since stdout is the protocol. */
  audit?: (line: string) => void;
}

export interface McpProcess {
  handle: BootHandle;
  server: Server;
  close: () => Promise<void>;
}

/**
 * The app as an MCP server, in its own process: boots in script mode (every
 * phase, no HTTP server), reads `config/mcp.config.ts` and serves
 * `ctx.agent` — `tools/list` is the manifest for the caller, `tools/call`
 * is `invoke()`, so the ACL, scopes and schemas decide exactly as over HTTP.
 *
 *   // mcp.ts
 *   import { serveMcp } from "@tulipes/mcp";
 *   await serveMcp({ rootDir: import.meta.dirname });
 */
export async function serveMcp(options: ServeMcpOptions): Promise<McpProcess> {
  const credential = tokenFrom(options.argv ?? process.argv.slice(2)) ?? process.env.TULIPES_MCP_TOKEN;
  const audit = options.audit ?? ((line: string) => process.stderr.write(line + "\n"));
  // On stdio, stdout belongs to the protocol: anything the app logs goes to stderr.
  const protocolOut = options.transport ? undefined : divertStdout();

  const handle = await boot({ rootDir: options.rootDir, mode: "script" });
  try {
    const config = await readConfig(options.rootDir);
    const variable = (config.identify as { [DEVELOPMENT]?: string } | undefined)?.[DEVELOPMENT];
    if (variable && (handle.ctx.appEnv === "production" || handle.ctx.appEnv === "staging")) {
      throw new Error(`config/mcp.config: developmentIdentity() reads the role from ${variable}, which is refused when APP_ENV is ${handle.ctx.appEnv} — identify callers from a credential`);
    }

    const identify = async (): Promise<ToolActor> => {
      const actor = config.identify ? await config.identify(handle.ctx as RuntimeCtx, credential) : null;
      return actor ?? { ...ANONYMOUS, role: GUEST_ROLE };
    };
    const first = await identify();
    const server = await createServer(inProcess(handle, identify, audit));
    await server.connect(options.transport ?? new StdioServerTransport(process.stdin, protocolOut));
    process.stderr.write(`[tulipes] mcp mode · ${options.transport ? "custom transport" : "stdio"} · ${first.role}${variable ? ` (from ${variable})` : ""}${first.scopes ? ` · scopes ${first.scopes.join(",")}` : ""}\n`);

    const close = async () => {
      await server.close();
      await handle.shutdown();
    };
    server.onclose = () => void handle.shutdown();
    return { handle, server, close };
  } catch (error) {
    await handle.shutdown();
    throw error;
  }
}

function inProcess(handle: BootHandle, identify: () => Promise<ToolActor>, audit: (line: string) => void): ToolSource {
  const agent = handle.ctx.agent!;
  return {
    manifest: async () => agent.manifest(await identify()),
    call: async (tool: AgentTool, input: unknown): Promise<ToolOutcome> => {
      const startedAt = Date.now();
      const actor = await identify();
      const line = (outcome: string) => audit(JSON.stringify({
        mcp: "call", tool: tool.name, actor: actorId(actor), role: actor.role, outcome, ms: Date.now() - startedAt,
      }));
      try {
        const data = await agent.invoke(tool.name, input ?? {}, actor);
        line("ok");
        return { ok: true, data };
      } catch (error) {
        if (error instanceof HttpError) {
          line(`refused ${error.code ?? error.status}`);
          return { ok: false, message: `${error.status}: ${error.defaultMessage ?? error.message}${error.code ? ` (${error.code})` : ""}` };
        }
        line("failed");
        process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
        return { ok: false, message: (error as Error).message };
      }
    },
  };
}

function actorId(actor: ToolActor): string {
  const id = (actor.user as { _id?: unknown; id?: unknown } | null)?._id ?? (actor.user as { id?: unknown } | null)?.id;
  return id === undefined ? (actor.isAuthenticated ? "configured" : "guest") : String(id);
}

function tokenFrom(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--token");
  return at >= 0 ? argv[at + 1] : undefined;
}

async function readConfig(rootDir: string): Promise<McpConfig> {
  const file = [".ts", ".js"].map((ext) => join(rootDir, "config", `mcp.config${ext}`)).find((path) => existsSync(path));
  if (!file) return {};
  const config = ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  if (!config || typeof config !== "object") throw new Error("config/mcp.config must default-export defineMcp({ ... })");
  const { transport, identify } = config as McpConfig;
  if (transport !== undefined && transport !== "stdio") {
    throw new Error(`config/mcp.config: transport ${JSON.stringify(transport)} is not supported — "stdio" is`);
  }
  if (identify !== undefined && typeof identify !== "function") throw new Error("config/mcp.config: identify must be a function");
  return config as McpConfig;
}

/** Keeps the real stdout for the protocol and sends every other write to stderr. */
function divertStdout(): Writable {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return new Writable({ write: (chunk, encoding, done) => { write(chunk, encoding, done); } });
}
