import type Anthropic from "@anthropic-ai/sdk";
import type { ToolActor } from "@tulipes/core/agent";

import type {
  Clock,
  Identity,
  ModelClient,
  ModelRequest,
  ModelTurn,
  RunEvents,
  StepEvent,
  ToolCatalog,
  ToolDefinition,
  ToolOutcome,
  ToolSource,
} from "../../helpers/harness/contracts.ts";

export const ACTOR: ToolActor = { isAuthenticated: true, user: null, session: null, role: "user" };

/** A model that plays a script: one turn per request, in order, and keeps what it was sent. */
export class ScriptedModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly #script: ((request: ModelRequest) => ModelTurn | Promise<ModelTurn>)[];

  constructor(script: (ModelTurn | ((request: ModelRequest) => ModelTurn | Promise<ModelTurn>))[]) {
    this.#script = script.map((step) => (typeof step === "function" ? step : () => step));
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(structuredClone({ ...request, signal: undefined }));
    const next = this.#script.shift();
    if (!next) throw new Error(`the script has no turn ${this.requests.length}`);
    return next(request);
  }

  get remaining(): number {
    return this.#script.length;
  }
}

let ids = 0;

export function toolUse(name: string, input: unknown = {}, id = `toolu_${++ids}`): Anthropic.Beta.BetaToolUseBlock {
  return { type: "tool_use", id, name, input, caller: { type: "direct" } } as Anthropic.Beta.BetaToolUseBlock;
}

export function text(value: string): Anthropic.Beta.BetaTextBlock {
  return { type: "text", text: value, citations: null };
}

export function turn(content: Anthropic.Beta.BetaContentBlock[], stopReason?: ModelTurn["stopReason"], usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }): ModelTurn {
  return { content, stopReason: stopReason ?? (content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn"), usage };
}

export function finish(outcome: "done" | "blocked" | "partial" = "done", summary = "Did it.", verification = "Read it back."): Anthropic.Beta.BetaToolUseBlock {
  return toolUse("run_finish", { outcome, summary, verification });
}

type Handler = (input: unknown, actor: ToolActor) => ToolOutcome | Promise<ToolOutcome>;

/** The app's actions, faked: definitions, handlers, and a record of each call. */
export class FakeTools implements ToolSource {
  readonly calls: { name: string; input: unknown }[] = [];
  readonly #tools: ToolDefinition[];
  readonly #handlers: Map<string, Handler>;

  constructor(tools: { name: string; readOnly: boolean; handler: Handler }[]) {
    this.#tools = tools
      .map(({ name, readOnly }) => ({ name, readOnly, description: `The ${name} tool.`, input_schema: { type: "object", properties: {}, additionalProperties: false } }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.#handlers = new Map(tools.map(({ name, handler }) => [name, handler]));
  }

  async catalog(): Promise<ToolCatalog> {
    return { modules: [{ name: "hello", summary: "Greets callers." }], tools: this.#tools };
  }

  async call(name: string, input: unknown, actor: ToolActor): Promise<ToolOutcome> {
    this.calls.push({ name, input });
    return this.#handlers.get(name)!(input, actor);
  }
}

export class FakeIdentity implements Identity {
  actor: ToolActor | null = ACTOR;

  async resolve(): Promise<ToolActor | null> {
    return this.actor;
  }
}

export class ManualClock implements Clock {
  time = 1_000_000;

  now(): number {
    return this.time;
  }
}

export class RecordedEvents implements RunEvents {
  readonly events: StepEvent[] = [];

  emit(event: StepEvent): void {
    this.events.push(event);
  }
}

/** A gate two calls must both reach before either may pass: proves they ran together. */
export function rendezvous(parties: number, timeoutMs = 2_000): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const all = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    if (++arrived === parties) release();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("the calls did not run concurrently")), timeoutMs); });
    try {
      await Promise.race([all, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
