import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";

import { AnthropicModelClient, type AnthropicSettings } from "../helpers/adapters/anthropic-client.ts";
import { ModelRejected, type ModelRequest } from "../helpers/harness/contracts.ts";

/*
 * The adapter against a stand-in for the SDK client: what it sends, how it
 * reads the answer, and which failures end a run. No network, no key.
 */

const SETTINGS: AnthropicSettings = { apiKey: "k", model: "claude-opus-5-5", effort: "high", refusalFallback: true };

const REQUEST: ModelRequest = {
  system: "You are an agent.",
  tools: [{ name: "hello_web_greetings", description: "List greetings.", input_schema: { type: "object", properties: {} }, readOnly: true }],
  messages: [{ role: "user", content: "<goal>\nx\n</goal>" }],
  maxTokens: 32_000,
};

function client(answer: () => Promise<unknown>) {
  const sent: Record<string, unknown>[] = [];
  const fake = { beta: { messages: { stream: (params: Record<string, unknown>) => { sent.push(params); return { finalMessage: answer }; } } } };
  return { sent, sdk: fake as unknown as Anthropic };
}

const message = (overrides: Record<string, unknown> = {}) => ({
  content: [{ type: "text", text: "hi", citations: null }],
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 },
  ...overrides,
});

describe("the Anthropic adapter", () => {
  test("sends the model, effort, a cached system prompt, plain tool definitions and the fallback opt-in", async () => {
    const { sent, sdk } = client(async () => message());
    const turn = await new AnthropicModelClient(SETTINGS, sdk).complete(REQUEST);

    expect(sent[0]).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 32_000,
      system: [{ type: "text", text: "You are an agent.", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "hello_web_greetings", description: "List greetings.", input_schema: { type: "object", properties: {} } }],
      output_config: { effort: "high" },
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(sent[0]!.tools).toEqual([expect.not.objectContaining({ readOnly: expect.anything() })]);
    expect(sent[0]).not.toHaveProperty("thinking");
    expect(turn).toEqual({ content: message().content, stopReason: "end_turn", usage: { input: 10, output: 5, cacheRead: 7, cacheWrite: 3 } });
  });

  test("leaves the fallback out when it is off, and reads a refusal's category", async () => {
    const { sent, sdk } = client(async () => message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }));
    const turn = await new AnthropicModelClient({ ...SETTINGS, refusalFallback: false }, sdk).complete(REQUEST);
    expect(sent[0]).not.toHaveProperty("fallbacks");
    expect(sent[0]).not.toHaveProperty("betas");
    expect(turn).toMatchObject({ stopReason: "refusal", refusalCategory: "cyber" });
  });

  test("a 4xx is a rejection that ends the run; a 5xx or a network failure is thrown as it is", async () => {
    const error = (status: number) => new Anthropic.APIError(status, { type: "error" }, `status ${status}`, new Headers());
    await expect(new AnthropicModelClient(SETTINGS, client(async () => { throw error(401); }).sdk).complete(REQUEST))
      .rejects.toEqual(expect.objectContaining({ name: "ModelRejected", reason: "model_rejected:401" }));
    await expect(new AnthropicModelClient(SETTINGS, client(async () => { throw error(529); }).sdk).complete(REQUEST))
      .rejects.not.toBeInstanceOf(ModelRejected);
    await expect(new AnthropicModelClient(SETTINGS, client(async () => { throw new TypeError("fetch failed"); }).sdk).complete(REQUEST))
      .rejects.toThrow("fetch failed");
  });
});
