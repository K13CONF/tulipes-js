import type { Request } from "express";
import { z } from "zod/v4";

import type { Acl } from "../acl/acl.ts";
import type { RuntimeCtx } from "../boot/contracts.ts";
import type { BootReport } from "../errors/boot-error.ts";
import { HttpError, ValidationError, type FieldIssue } from "../http/error-handler.ts";
import type { RouteRegistry } from "../http/rai.ts";
import { codeOfIssue, type ValidatableSchema } from "../http/schema.ts";
import type { ModuleManifest } from "../modules/manifest.ts";
import type { ActionTool, AgentDeclaration, ToolActor } from "./define-agent.ts";

export type JsonSchema = Record<string, unknown>;

/** One tool as an agent sees it — what the manifest and MCP list. */
export interface AgentTool {
  /** `^[a-zA-Z0-9_-]{1,64}$`, derived from the id: `hello:reset-counts` → `hello_reset-counts`. */
  name: string;
  module: string;
  /** The action's id, which is also the permission the ACL decides on. */
  permission: string;
  title?: string;
  description: string;
  input_schema: JsonSchema;
  /** A tool that changes nothing, as its declaration says. */
  read_only: boolean;
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
  action: ActionTool;
}

/** Claude's and MCP's tool-name alphabet. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function toolNameOf(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * `ctx.agent` — every action the app's modules declare, built from the
 * `agent/` declarations once the ACL exists, in every process mode. The
 * manifest is the same object `tulipes agent manifest` writes and the
 * HTTP transport serves; `invoke()` runs an action through the same gate
 * a route has — ACL on the id, input validated, errors as HttpErrors the
 * envelope renders. An in-app agent module uses both directly: the
 * manifest as its tool definitions, `invoke()` for each tool call.
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

  /** @internal Every mode, after the ACL. */
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
    const owners = new Map<string, string>();

    for (const module of modules) {
      const declaration = declarations.get(module.name);
      const names: string[] = [];
      for (const spec of declaration?.actions ?? []) {
        const resolved = this.#fromAction(module.name, spec);
        const { name, permission } = resolved.tool;
        if (!TOOL_NAME.test(name)) {
          report.add({ scope: "agent", module: module.name, message: `tool "${permission}" has no valid name` });
          continue;
        }
        const owner = owners.get(name);
        if (owner) {
          report.add({ scope: "agent", module: module.name, message: `tool "${name}" (${permission}) is already exposed by ${owner}` });
          continue;
        }
        owners.set(name, `module "${module.name}" as "${permission}"`);
        this.#tools.set(name, resolved);
        names.push(name);
      }
      this.#modules.push({ name: module.name, ...(declaration?.summary && { summary: declaration.summary }), tools: names });
    }
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
   * Run an action as `actor`. The same order as a route: who may (401 for
   * a guest, 403 for a role without the permission), then what (422 with
   * field issues), then the handler.
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
