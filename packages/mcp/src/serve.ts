import { existsSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

export interface McpHttpTransport {
  http: {
    port: number;
    /** Defaults to 127.0.0.1; set 0.0.0.0 to reach it from another host (behind your ingress). */
    host?: string;
    /** Defaults to /mcp. */
    path?: string;
  };
}

export interface McpConfig {
  /**
   * "stdio" (the default): one client, the process's own, identified by
   * `--token`. `{ http: { port } }`: MCP's Streamable HTTP, any number of
   * clients, each request identified by its `Authorization: Bearer`.
   */
  transport?: "stdio" | McpHttpTransport;
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
  /** The MCP server, on stdio or a custom transport. */
  server?: Server;
  /** The HTTP listener and its endpoint, on the http transport. */
  http?: HttpServer;
  url?: string;
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
  // On stdio, stdout belongs to the protocol: anything the app logs goes to
  // stderr. Which transport it is is only known after boot, so the diversion
  // starts now and is undone for http.
  const diverted = options.transport ? undefined : divertStdout();

  const handle = await boot({ rootDir: options.rootDir, mode: "script" });
  try {
    const config = await readConfig(options.rootDir);
    const variable = (config.identify as { [DEVELOPMENT]?: string } | undefined)?.[DEVELOPMENT];
    if (variable && (handle.ctx.appEnv === "production" || handle.ctx.appEnv === "staging")) {
      throw new Error(`config/mcp.config: developmentIdentity() reads the role from ${variable}, which is refused when APP_ENV is ${handle.ctx.appEnv} — identify callers from a credential`);
    }

    const identify = (credential: string | undefined) => async (): Promise<ToolActor> => {
      const actor = config.identify ? await config.identify(handle.ctx as RuntimeCtx, credential) : null;
      return actor ?? { ...ANONYMOUS, role: GUEST_ROLE };
    };
    const source = (credential: string | undefined) => inProcess(handle, identify(credential), audit);

    if (!options.transport && typeof config.transport === "object") {
      diverted?.restore();
      if (!config.identify && (handle.ctx.appEnv === "production" || handle.ctx.appEnv === "staging")) {
        throw new Error(`config/mcp.config: the http transport has no identify, which would serve every caller on the network as a guest — refused when APP_ENV is ${handle.ctx.appEnv}`);
      }
      const { http, url } = await serveHttp(config.transport.http, source);
      process.stderr.write(`[tulipes] mcp mode · http ${url} · ${config.identify ? "bearer identified per request" : "every caller a guest"}\n`);
      const close = async () => {
        await new Promise<void>((resolve) => http.close(() => resolve()));
        await handle.shutdown();
      };
      return { handle, http, url, close };
    }

    const first = await identify(credential)();
    const server = await createServer(source(credential));
    await server.connect(options.transport ?? new StdioServerTransport(process.stdin, diverted!.out));
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
  const http = typeof transport === "object" && transport !== null ? (transport as Partial<McpHttpTransport>).http : undefined;
  if (transport !== undefined && transport !== "stdio" && !(http && Number.isInteger(http.port) && http.port >= 0 && http.port <= 65_535)) {
    throw new Error(`config/mcp.config: transport ${JSON.stringify(transport)} is not supported — "stdio" or { http: { port } }`);
  }
  if (identify !== undefined && typeof identify !== "function") throw new Error("config/mcp.config: identify must be a function");
  return config as McpConfig;
}

/**
 * Streamable HTTP, stateless: every POST gets its own server and transport,
 * bound to the actor its bearer identifies, so a revoked token is refused on
 * its next request and two clients never share an identity. No CORS, no
 * cookies — a machine endpoint.
 */
async function serveHttp(options: McpHttpTransport["http"], source: (credential: string | undefined) => ToolSource) {
  const path = options.path ?? "/mcp";
  const http = createHttpServer(async (req, res) => {
    const answer = (status: number, message: string) => {
      if (res.headersSent) return;
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
    };
    if (new URL(req.url ?? "/", "http://mcp").pathname !== path) return answer(404, `not found — the MCP endpoint is ${path}`);
    // Stateless: no session to resume, no server-initiated stream to open.
    if (req.method !== "POST") return answer(405, "method not allowed — POST JSON-RPC to this endpoint");
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString() || "null");
      const credential = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      const server = await createServer(source(credential));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (error instanceof SyntaxError) return answer(400, "the body is not JSON");
      process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
      answer(500, "internal error");
    }
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, host, () => resolve());
  });
  const { port } = http.address() as AddressInfo;
  return { http, url: `http://${host.includes(":") ? `[${host}]` : host}:${port}${path}` };
}

/** Keeps the real stdout for the protocol and sends every other write to stderr, until restored. */
function divertStdout(): { out: Writable; restore: () => void } {
  const original = process.stdout.write;
  const write = original.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return {
    out: new Writable({ write: (chunk, encoding, done) => { write(chunk, encoding, done); } }),
    restore: () => { process.stdout.write = original; },
  };
}
