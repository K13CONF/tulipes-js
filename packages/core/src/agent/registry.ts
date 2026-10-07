import type { Request } from "express";
import { z } from "zod/v4";

import type { Acl } from "../acl/acl.js";
import type { RuntimeCtx } from "../boot/contracts.js";
import type { BootReport } from "../errors/boot-error.js";
import { HttpError, ValidationError, type FieldIssue } from "../http/error-handler.js";
import type { RouteInfo, RouteRecord, RouteRegistry } from "../http/rai.js";
import { codeOfIssue, type ValidatableSchema } from "../http/schema.js";
import type { ModuleManifest } from "../modules/manifest.js";
import type { ActionTool, AgentDeclaration, RouteTool, ToolActor } from "./define-agent.js";

export type JsonSchema = Record<string, unknown>;

/** One tool as an agent sees it — what the manifest and MCP list. */
export interface AgentTool {
  /** `^[a-zA-Z0-9_-]{1,64}$`, derived from the id: `hello:list-greetings` → `hello_list-greetings`. */
  name: string;
  module: string;
  /** The RAI id, which is also the permission the ACL decides on. */
  permission: string;
  title?: string;
  description: string;
  input_schema: JsonSchema;
  /** A tool that changes nothing: GET routes, and actions that say so. */
  read_only: boolean;
  /** How to call it: at its own path, or through the action endpoint. */
  transport: { kind: "http"; method: string; path: string } | { kind: "action" };
}

export interface AgentManifest {
  app: { name: string; version?: string };
  /** "dynamic" when the app replaced the ACL with its own checker: no role filtering is possible. */
  authorization: "acl" | "dynamic";
  modules: { name: string; summary?: string; tools: string[] }[];
  tools: AgentTool[];
}

interface Resolved {
  tool: AgentTool;
  info?: RouteInfo;
  action?: ActionTool;
}

/** Claude's and MCP's tool-name alphabet. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function toolNameOf(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * `ctx.agent` — every tool the app exposes, built once routes are scanned:
 * route tools from the RAIs, action tools from the `agent/` declarations.
 * The manifest is the same object `tulipes agent manifest` writes and the
 * HTTP transport serves; `invoke()` runs a declared action through the
 * same gate a route has — ACL on the id, input validated, errors as
 * HttpErrors the envelope renders.
 */
export class AgentRegistry {
  readonly #tools = new Map<string, Resolved>();
  readonly #modules: { name: string; summary?: string; tools: string[] }[] = [];
  readonly #warnings: string[] = [];
  #acl: Acl | undefined;
  #routes: RouteRegistry | undefined;
  #ctx: RuntimeCtx | undefined;
  #app: { name: string; version?: string } = { name: "api" };

  /** Schemas that produced no JSON Schema, for the CLI to print. */
  get warnings(): readonly string[] {
    return this.#warnings;
  }

  /** @internal The backend branch, after the route scan. */
  build_(
    ctx: RuntimeCtx,
    modules: readonly ModuleManifest[],
    declarations: ReadonlyMap<string, AgentDeclaration>,
    report: BootReport,
  ): void {
    this.#ctx = ctx;
    this.#acl = ctx.acl;
    this.#routes = ctx.routes;
    const app = ctx.config.app as { name?: unknown; version?: unknown } | undefined;
    this.#app = {
      name: String(app?.name ?? "api"),
      ...(typeof app?.version === "string" && { version: app.version }),
    };
    const records = ctx.routes.all();
    const owners = new Map<string, string>();

    for (const module of modules) {
      const declaration = declarations.get(module.name);
      const own = records.filter((record) => record.module === module.name && record.info.agent !== false);
      const names: string[] = [];
      const add = (resolved: Resolved) => {
        const { name, permission } = resolved.tool;
        if (!TOOL_NAME.test(name)) {
          report.add({ scope: "agent", module: module.name, message: `tool "${permission}" has no valid name` });
          return;
        }
        const owner = owners.get(name);
        if (owner) {
          report.add({ scope: "agent", module: module.name, message: `tool "${name}" (${permission}) is already exposed by ${owner}` });
          return;
        }
        owners.set(name, `module "${module.name}" as "${this.#tools.get(name)?.tool.permission ?? permission}"`);
        this.#tools.set(name, resolved);
        names.push(name);
      };

      if (declaration?.tools === undefined) {
        for (const record of own) add(this.#fromRoute(record, {}));
      } else {
        for (const spec of declaration.tools) {
          if ("route" in spec) {
            const matched = own.filter((record) => matches(spec.route, record.info.id));
            if (matched.length === 0) {
              report.add({
                scope: "agent",
                module: module.name,
                message: `route "${spec.route}" matches no endpoint this module declares (known: ${own.map((r) => r.info.id).join(", ") || "none"})`,
              });
            }
            for (const record of matched) add(this.#fromRoute(record, spec));
          } else {
            add(this.#fromAction(module.name, spec));
          }
        }
      }
      this.#modules.push({ name: module.name, ...(declaration?.summary && { summary: declaration.summary }), tools: names });
    }
  }

  #fromRoute(record: RouteRecord, overrides: Partial<RouteTool>): Resolved {
    const { info } = record;
    const method = record.method.toUpperCase();
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const segment of ["params", "query", "body"] as const) {
      const schema = info[segment];
      if (!schema) continue;
      const json = this.#jsonSchema(schema, `${info.id} ${segment}`);
      properties[segment] = json;
      if (Array.isArray(json.required) && json.required.length > 0) required.push(segment);
    }
    // A path parameter the route never described is still one the agent
    // has to supply: `/greetings/:name` without a params schema lists
    // `name` as a required string.
    const named = [...record.path.matchAll(/:(\w+)/g)].map((match) => match[1]!);
    if (!info.params && named.length > 0) {
      properties.params = {
        type: "object",
        properties: Object.fromEntries(named.map((name) => [name, { type: "string" }])),
        required: named,
        additionalProperties: false,
      };
      required.unshift("params");
    }
    const title = overrides.title ?? info.name;
    return {
      info,
      tool: {
        name: toolNameOf(info.id),
        module: record.module,
        permission: info.id,
        ...(title && { title }),
        description: overrides.description ?? info.description ?? info.name ?? info.id,
        input_schema: { type: "object", properties, required, additionalProperties: false },
        read_only: method === "GET" || method === "HEAD",
        transport: { kind: "http", method, path: record.path },
      },
    };
  }

  #fromAction(module: string, spec: ActionTool): Resolved {
    return {
      action: spec,
      tool: {
        name: toolNameOf(spec.id),
        module,
        permission: spec.id,
        ...(spec.title && { title: spec.title }),
        description: spec.description,
        input_schema: spec.input
          ? this.#jsonSchema(spec.input, `${spec.id} input`)
          : { type: "object", properties: {}, additionalProperties: false },
        read_only: spec.readOnly === true,
        transport: { kind: "action" },
      },
    };
  }

  /**
   * Zod 4 describes itself; anything else degrades to an open object with
   * a warning, so the manifest still lists the tool. Strict tool use wants
   * closed objects, so `additionalProperties: false` is set where zod
   * left it open.
   */
  #jsonSchema(schema: ValidatableSchema, label: string): JsonSchema {
    try {
      const json = z.toJSONSchema(schema as never, { unrepresentable: "any", io: "input" }) as JsonSchema;
      delete json.$schema;
      if (json.type === "object" && json.additionalProperties === undefined) json.additionalProperties = false;
      return json;
    } catch (error) {
      this.#warnings.push(`${label}: ${(error as Error).message}`);
      return { type: "object" };
    }
  }

  /** Every tool, or those a role may call. */
  tools(role?: string): AgentTool[] {
    const visible = [...this.#tools.values()].map(({ tool }) => tool);
    if (role === undefined || this.#routes?.checker) return visible;
    return visible.filter((tool) => this.#acl?.can(role, tool.permission) === true);
  }

  find(name: string): AgentTool | undefined {
    return this.#tools.get(name)?.tool;
  }

  manifest(role?: string): AgentManifest {
    const tools = this.tools(role);
    const names = new Set(tools.map((tool) => tool.name));
    return {
      app: this.#app,
      authorization: this.#routes?.checker ? "dynamic" : "acl",
      modules: this.#modules
        .map((module) => ({ ...module, tools: module.tools.filter((name) => names.has(name)) }))
        .filter((module) => module.tools.length > 0 || module.summary),
      tools,
    };
  }

  /**
   * Run a declared action as `actor`. The same order as a route: who may
   * (401 for a guest, 403 for a role without the permission), then what
   * (422 with field issues), then the handler. A route tool is refused
   * with its own method and path — it is called there, through the app's
   * middleware, not around it.
   */
  async invoke(name: string, input: unknown, actor: ToolActor, request?: Request): Promise<unknown> {
    const resolved = this.#tools.get(name);
    if (!resolved) {
      throw new HttpError(404, "noSuchTool", {
        code: "NO_SUCH_TOOL",
        vars: { name },
        defaultMessage: `no tool named "${name}"`,
      });
    }
    const { tool, action } = resolved;
    if (!action || tool.transport.kind !== "action") {
      throw new HttpError(400, "routeTool", {
        code: "ROUTE_TOOL",
        vars: { name, method: (tool.transport as { method: string }).method, path: (tool.transport as { path: string }).path },
        defaultMessage: `"${name}" is an endpoint — call ${(tool.transport as { method: string }).method} ${(tool.transport as { path: string }).path}`,
      });
    }

    const allowed = this.#routes?.checker && request
      ? await this.#routes.checker(request, { id: tool.permission, name: tool.title, description: tool.description })
      : this.#acl?.can(actor.role, tool.permission) === true;
    if (allowed !== true) {
      throw actor.isAuthenticated
        ? new HttpError(403, "forbidden", {
            code: "FORBIDDEN",
            vars: { role: actor.role, permission: tool.permission },
            defaultMessage: `role "${actor.role}" may not ${tool.permission}`,
          })
        : new HttpError(401, "unauthenticated", {
            code: "UNAUTHENTICATED",
            defaultMessage: "authentication required",
          });
    }

    let parsed: unknown = undefined;
    if (action.input) {
      const result = action.input.safeParse(input ?? {});
      if (!result.success) {
        const issues: FieldIssue[] = result.error.issues.map((issue) => ({
          field: issue.path.map(String).join(".") || "input",
          message: issue.message,
          ...(codeOfIssue(issue) && { code: codeOfIssue(issue)! }),
        }));
        throw new ValidationError(issues);
      }
      parsed = result.data;
    }

    return action.handler(this.#ctx!, parsed, actor);
  }
}

/** `"*"`, `"hello:*"` or an exact id, with the ACL's namespace meaning. */
function matches(reference: string, id: string): boolean {
  if (reference === "*" || reference === id) return true;
  return reference.endsWith(":*") && id.startsWith(reference.slice(0, -1));
}
