import type { RuntimeCtx } from "@tulipes/core/boot";
import { moduleLogger } from "@app/core";

import { AnthropicModelClient } from "./adapters/anthropic-client.ts";
import { AuthIdentity } from "./adapters/auth-identity.ts";
import { MongoRunStore, MongoStepLog } from "./adapters/mongo-run-store.ts";
import { RegistryToolSource } from "./adapters/registry-tool-source.ts";
import { ModelRejected, type Clock, type ModelClient } from "./harness/contracts.ts";
import { FanOutEvents } from "./harness/events.ts";
import { BudgetLimits } from "./harness/limits.ts";
import { ModeApprovalPolicy } from "./harness/policy.ts";
import { systemPrompt } from "./harness/prompt.ts";
import { RunLoop } from "./harness/run-loop.ts";
import { ResultShaper } from "./harness/shaper.ts";
import { RepetitionGuard } from "./harness/trajectory.ts";

/** What a test may put in place of the real thing: the model, and time. */
export interface LoopOverrides {
  model?: ModelClient;
  clock?: Clock;
}

/** Whether this deployment can run agents at all: the key is an environment value. */
export function agentsConfigured(ctx: Pick<RuntimeCtx, "config">): boolean {
  return Boolean(ctx.config.agents?.anthropicApiKey);
}

/**
 * The one place the harness is assembled: every adapter, from the settings
 * as they are now. Called once per job, so a setting changed in the console
 * applies to the next job of every run and never halfway through one.
 */
export function composeLoop(ctx: RuntimeCtx, overrides: LoopOverrides = {}): RunLoop {
  const settings = ctx.config.agents!;
  const log = moduleLogger(ctx, "agents");
  const app = String((ctx.config.app as { name?: unknown } | undefined)?.name ?? "app");

  return new RunLoop({
    store: new MongoRunStore(ctx, { retentionDays: settings.retentionDays }),
    model: overrides.model ?? modelFor(ctx),
    tools: new RegistryToolSource(ctx, (error, tool) => log.error({ err: error, tool }, "agent tool failed")),
    policy: new ModeApprovalPolicy(settings.approval),
    limits: new BudgetLimits({
      maxTurns: settings.maxTurns,
      maxToolCalls: settings.maxToolCalls,
      maxOutputTokens: settings.maxOutputTokens,
      maxRunMs: settings.maxRunMinutes * 60_000,
    }),
    guard: new RepetitionGuard(),
    results: new ResultShaper(settings.toolResultMaxChars),
    identity: new AuthIdentity(ctx),
    events: new FanOutEvents(
      [{ emit: (event) => log.info(event, "agent step") }, new MongoStepLog(ctx)],
      (error, event) => log.warn({ err: error, run: event.runId }, "agent step not recorded"),
    ),
    clock: overrides.clock ?? Date,
    system: (modules) => systemPrompt({
      app,
      modules,
      policy: {
        approval: settings.approval,
        maxTurns: settings.maxTurns,
        maxToolCalls: settings.maxToolCalls,
        locale: String((ctx.config.i18n as { defaultLocale?: unknown } | undefined)?.defaultLocale ?? "en"),
        timezone: String((ctx.config.timezone as { default?: unknown } | undefined)?.default ?? "UTC"),
      },
    }),
    settings: { maxTokens: settings.maxTokensPerTurn, retryMaxTokens: settings.maxTokensPerTurn * 2 },
  });
}

function modelFor(ctx: RuntimeCtx): ModelClient {
  const { anthropicApiKey, anthropicBaseUrl, model, effort, refusalFallback } = ctx.config.agents!;
  // The key was there when the run started and is gone now: the run ends
  // with a reason rather than the job failing three times.
  if (!anthropicApiKey) {
    return { complete: async () => { throw new ModelRejected("agent_unconfigured", "ANTHROPIC_API_KEY is not set"); } };
  }
  return new AnthropicModelClient({
    apiKey: anthropicApiKey,
    ...(anthropicBaseUrl && { baseURL: anthropicBaseUrl }),
    model,
    effort,
    refusalFallback,
  });
}
