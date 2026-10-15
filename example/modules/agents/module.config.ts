import { defineConfig } from "@tulipes/core/config";
import { z } from "zod/v4";

/**
 * How agent runs behave, edited live through the console: a change applies
 * to the next job of every run, never halfway through one. The API key is
 * not here — it is an environment value (package.json `tulipes.env`), read
 * at `ctx.config.agents.anthropicApiKey`.
 */
export default defineConfig({
  schema: z.object({
    model: z.string().min(1).default("claude-opus-5-5")
      .describe("Claude model every run uses"),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high")
      .describe("How hard the model thinks per turn; agentic work repays high"),
    approval: z.enum(["none", "writes", "all"]).default("writes")
      .describe("Which tool calls wait for the person who started the run: none, those that change something, or all"),
    maxTurns: z.number().int().positive().default(30)
      .describe("Model turns a run may take before it ends exhausted"),
    maxToolCalls: z.number().int().positive().default(100)
      .describe("Tool calls a run may make before it ends exhausted"),
    maxOutputTokens: z.number().int().positive().default(200_000)
      .describe("Output tokens a run may spend before it ends exhausted"),
    maxRunMinutes: z.number().positive().default(10)
      .describe("Minutes of work a run may take, not counting time waiting for approval"),
    maxTokensPerTurn: z.number().int().positive().default(32_000)
      .describe("max_tokens of one model turn; a turn cut off is retried once with twice this"),
    toolResultMaxChars: z.number().int().min(1_000).default(8_000)
      .describe("Longest tool result the model reads; longer is cut, saying what was left out"),
    refusalFallback: z.boolean().default(true)
      .describe("When the model declines on safety grounds, let the API retry the turn on a fallback model"),
    retentionDays: z.number().int().positive().default(30)
      .describe("Days a finished run, its transcript included, is kept"),
  }),
});
