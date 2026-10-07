import type { RuntimeCtx } from "../boot/contracts.ts";
import type { Auth } from "../http/index.ts";
import type { ValidatableSchema } from "../http/schema.ts";

/**
 * Who is calling a tool: the request's `Auth` plus the role the ACL
 * decides on. The HTTP transport builds it from `req.auth`; a handler
 * reads the user off it the way a route handler reads `req.auth.user`.
 */
export interface ToolActor extends Auth {
  role: string;
}

/**
 * A tool derived from an endpoint. Name, description, input schema and
 * permission all come from the route's RAI; the two optional fields
 * override what the agent sees without touching the route.
 *
 * `route` is a RAI id of this module, `"<module>:*"` for every route of
 * that namespace, or `"*"` for every route the module declared.
 */
export interface RouteTool {
  route: string;
  title?: string;
  description?: string;
}

/**
 * A tool that is not an endpoint: an action with its own id, input schema
 * and handler. The id is a RAI-style permission (`hello:reset-counts`),
 * granted in `module.acl.ts` like any other, and the handler runs only for
 * an actor whose role holds it, with an input the schema accepted.
 */
export interface ActionTool<Input = unknown> {
  id: string;
  title?: string;
  description: string;
  /** Validates the input; omitted means the tool takes no input. */
  input?: ValidatableSchema<Input>;
  /** Marks a tool that changes nothing, so an agent may call it freely. */
  readOnly?: boolean;
  handler: (ctx: RuntimeCtx, input: Input, actor: ToolActor) => unknown;
}

export type AgentToolSpec = RouteTool | ActionTool<any>;

export interface AgentDeclarationInput {
  /** One or two sentences on what the module does, for the manifest. */
  summary?: string;
  /**
   * The tools this module exposes. Omitted, every route the module
   * declared is a tool (minus those with `agent: false` on their RAI);
   * given, exactly these — curated exposure plus declared actions.
   */
  tools?: readonly AgentToolSpec[];
}

/** Symbol.for so a declaration survives duplicate copies of core. */
export const AGENT_DECLARATION = Symbol.for("tulipes.agent-declaration");

export interface AgentDeclaration extends AgentDeclarationInput {
  readonly [AGENT_DECLARATION]: true;
}

/**
 * Default export of `agent/*.agent.ts`. The file adds what cannot be
 * derived from the routes: a module summary, which routes an agent should
 * see, and actions that are not endpoints.
 */
export function defineAgent(declaration: AgentDeclarationInput): AgentDeclaration {
  return Object.freeze({ ...declaration, [AGENT_DECLARATION]: true as const });
}

export function isAgentDeclaration(value: unknown): value is AgentDeclaration {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[AGENT_DECLARATION] === true;
}

/**
 * Types a declared action's handler from its input schema, which an object
 * literal inside the `tools` array cannot do by itself:
 *
 *   action({ id: "hello:reset", description: "…", input: z.object({ confirm: z.literal(true) }),
 *            handler: async ({ models }, { confirm }) => … })
 */
export function action<Input = undefined>(tool: ActionTool<Input>): ActionTool<Input> {
  return tool;
}

/** Every reason a declaration is not usable, for the boot report. */
export function agentDeclarationProblems(declaration: AgentDeclaration): string[] {
  const problems: string[] = [];
  if (declaration.summary !== undefined && typeof declaration.summary !== "string") problems.push("summary must be a string");
  if (declaration.tools === undefined) return problems;
  if (!Array.isArray(declaration.tools)) return [...problems, "tools must be an array"];
  declaration.tools.forEach((tool, index) => {
    const at = `tools[${index}]`;
    if (typeof tool !== "object" || tool === null) { problems.push(`${at} must be an object`); return; }
    if ("route" in tool) {
      if (typeof tool.route !== "string" || !ROUTE_REF.test(tool.route)) problems.push(`${at}.route must be a RAI id, "<module>:*" or "*"`);
      return;
    }
    const spec = tool as Partial<ActionTool>;
    if (typeof spec.id !== "string" || !ACTION_ID.test(spec.id)) problems.push(`${at}.id must be a "<module>:<action>" permission`);
    if (typeof spec.description !== "string" || spec.description.length === 0) problems.push(`${at}.description is required`);
    if (typeof spec.handler !== "function") problems.push(`${at}.handler must be a function`);
    if (spec.input !== undefined && typeof (spec.input as { safeParse?: unknown }).safeParse !== "function") {
      problems.push(`${at}.input must be a schema with safeParse`);
    }
  });
  return problems;
}

const ROUTE_REF = /^(\*|[a-z0-9-]+:\*|[a-z0-9-]+:[a-z0-9-]+)$/;
const ACTION_ID = /^[a-z0-9-]+:[a-z0-9-]+$/;
