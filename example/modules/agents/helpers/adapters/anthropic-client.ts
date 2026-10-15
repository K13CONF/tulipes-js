import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { ModelRejected, type ModelClient, type ModelRequest, type ModelTurn } from "../harness/contracts.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicSettings {
  apiKey: string;
  baseURL?: string;
  model: string;
  effort: Effort;
  /** On a safety refusal, let the API re-run the turn on a fallback model it chooses. */
  refusalFallback: boolean;
}

/** The statuses that say the request itself is wrong: a retry sends the same thing. */
const REJECTED = new Set([400, 401, 403, 404, 413, 422]);

/**
 * The ModelClient over the Claude API — the one file in the module that
 * imports the SDK at runtime. Each request streams (a long turn would
 * outlive a plain request's timeout) and is collected with finalMessage().
 *
 * Caching: one breakpoint on the system prompt, which is the same for
 * every run of a deployment, and automatic caching of the conversation's
 * tail, so each turn reads the turns before it from cache. The tool list is
 * fixed for a job and sorted, so it never invalidates either.
 *
 * Thinking is adaptive (the parameter omitted: on the current models it is
 * always on), its depth set by `effort`. Tools are sent non-strict: the
 * app's own schemas validate every call in `invoke()`, and a rejected
 * input comes back to the model as a 422 it can act on.
 */
export class AnthropicModelClient implements ModelClient {
  readonly #client: Anthropic;
  readonly #settings: AnthropicSettings;

  constructor(settings: AnthropicSettings, client?: Anthropic) {
    this.#settings = settings;
    this.#client = client ?? new Anthropic({ apiKey: settings.apiKey, ...(settings.baseURL && { baseURL: settings.baseURL }) });
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const { model, effort, refusalFallback } = this.#settings;
    const params: BetaMessageStreamParams = {
      model,
      max_tokens: request.maxTokens,
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      tools: request.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema: input_schema as Anthropic.Beta.BetaTool.InputSchema })),
      messages: [...request.messages],
      output_config: { effort },
      cache_control: { type: "ephemeral" },
      ...(refusalFallback && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    };
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.#client.beta.messages.stream(params, { signal: request.signal }).finalMessage();
    } catch (error) {
      if (error instanceof Anthropic.APIError && error.status !== undefined && REJECTED.has(error.status)) {
        throw new ModelRejected(`model_rejected:${error.status}`, error.message);
      }
      throw error;
    }
    return {
      content: message.content,
      stopReason: message.stop_reason ?? "end_turn",
      ...(message.stop_reason === "refusal" && { refusalCategory: message.stop_details?.category ?? null }),
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
