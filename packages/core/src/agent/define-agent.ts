import { isRai, RAI_SHAPE, type Rai } from "../acl/rai-id.ts";
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
 * An action a module offers to agents and to other modules: an id, an
 * input schema and a handler. The id is a RAI (`hello:bo:greetings:reset`),
 * the permission granted in `module.acl.ts` like any other, and
 * the handler runs only for an actor whose role holds it, with an input
 * the schema accepted. Routes are the API; an action is never derived
 * from one, and the two share logic through the module's helpers.
 */
export interface ActionTool<Input = unknown> {
  /** A RAI id, `module:scope:resource[:extra]`; also the permission. */
  id: Rai;
  title?: string;
  description: string;
  /** Validates the input; omitted means the tool takes no input. */
  input?: ValidatableSchema<Input>;
  /** Marks a tool that changes nothing, so an agent may call it freely. */
  readOnly?: boolean;
  handler: (ctx: RuntimeCtx, input: Input, actor: ToolActor) => unknown;
}

export interface AgentDeclarationInput {
  /** One or two sentences on what the module does, for the manifest. */
  summary?: string;
  /** The actions this module offers. A module with no declaration offers none. */
  actions?: readonly ActionTool<any>[];
}

/** Symbol.for so a declaration survives duplicate copies of core. */
export const AGENT_DECLARATION = Symbol.for("tulipes.agent-declaration");

export interface AgentDeclaration extends AgentDeclarationInput {
  readonly [AGENT_DECLARATION]: true;
}

/** Default export of `agent/*.agent.ts`: the module's summary and its actions. */
export function defineAgent(declaration: AgentDeclarationInput): AgentDeclaration {
  return Object.freeze({ ...declaration, [AGENT_DECLARATION]: true as const });
}

export function isAgentDeclaration(value: unknown): value is AgentDeclaration {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[AGENT_DECLARATION] === true;
}

/**
 * Types a declared action's handler from its input schema, which an object
 * literal inside the `actions` array cannot do by itself:
 *
 *   action({ id: "hello:bo:reset", description: "…", input: z.object({ confirm: z.literal(true) }),
 *            handler: async ({ models }, { confirm }) => … })
 */
export function action<Input = undefined>(tool: ActionTool<Input>): ActionTool<Input> {
  return tool;
}

/** Every reason a declaration is not usable, for the boot report. */
export function agentDeclarationProblems(declaration: AgentDeclaration): string[] {
  const problems: string[] = [];
  if (declaration.summary !== undefined && typeof declaration.summary !== "string") problems.push("summary must be a string");
  if ("tools" in declaration) {
    problems.push('"tools" is "actions" since 0.11.0-rc.3, and routes are no longer tools — declare only actions (tulipes migrate 0.11 rewrites the file)');
  }
  if (declaration.actions === undefined) return problems;
  if (!Array.isArray(declaration.actions)) return [...problems, "actions must be an array"];
  declaration.actions.forEach((spec: Partial<ActionTool> & { route?: unknown }, index) => {
    const at = `actions[${index}]`;
    if (typeof spec !== "object" || spec === null) { problems.push(`${at} must be an object`); return; }
    if ("route" in spec) { problems.push(`${at} is a route reference — routes are the API, not tools`); return; }
    if (!isRai(spec.id)) problems.push(`${at}.id "${String(spec.id)}" is invalid — expected ${RAI_SHAPE}`);
    if (typeof spec.description !== "string" || spec.description.length === 0) problems.push(`${at}.description is required`);
    if (typeof spec.handler !== "function") problems.push(`${at}.handler must be a function`);
    if (spec.input !== undefined && typeof (spec.input as { safeParse?: unknown }).safeParse !== "function") {
      problems.push(`${at}.input must be a schema with safeParse`);
    }
  });
  return problems;
}
