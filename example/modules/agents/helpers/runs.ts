import type { RuntimeCtx } from "@tulipes/core/boot";
import { requireModels, requireQueues } from "@tulipes/core/boot";
import { HttpError, type Auth } from "@tulipes/core/http";

import { toRun, type RunDocument } from "./adapters/mongo-run-store.ts";
import { agentsConfigured } from "./compose.ts";
import type { Run } from "./harness/contracts.ts";
import { openingMessage } from "./harness/prompt.ts";

export interface StartRun {
  goal: string;
  /** Anything the person attaches to the goal: an id, a pasted message. */
  context?: string;
}

/**
 * The use cases of the runs, for the controllers (and for an action, if
 * one is ever declared): no request, no response — a caller, an input,
 * the run.
 */

/**
 * A new run for the caller, queued. It records who the caller is and the
 * scopes of the credential they used — never the credential — and the
 * job that will run it.
 */
export async function startRun(ctx: RuntimeCtx, auth: Auth, input: StartRun): Promise<Run> {
  if (!agentsConfigured(ctx)) {
    throw new HttpError(503, "agentUnconfigured", { code: "AGENT_UNCONFIGURED", defaultMessage: "agent runs are not configured on this deployment" });
  }
  if (!auth.isAuthenticated || !auth.user) throw new HttpError(401, "unauthenticated", { code: "UNAUTHENTICATED", defaultMessage: "authentication required" });

  const created = await requireModels(ctx).get("AgentRun").create({
    user: (auth.user as { _id: unknown })._id,
    ...(auth.scopes && { scopes: [...auth.scopes] }),
    ...(auth.credentialId && { token_id: auth.credentialId }),
    goal: input.goal,
    transcript: [openingMessage(input.goal, input.context)],
    status: "queued",
    segment: 1,
  });
  await enqueue(ctx, String(created._id), 1);
  return toRun(created.toObject() as unknown as RunDocument);
}

/**
 * One job per segment of a run: the start, then each approval. The job id
 * carries the segment, so enqueueing the same segment twice — a retried
 * request — is still one job, and two jobs never work on one run at once.
 */
export async function enqueue(ctx: RuntimeCtx, runId: string, segment: number): Promise<void> {
  await requireQueues(ctx).add("agents.run", "run", { run_id: runId }, {
    jobId: `${runId}-${segment}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 1_000,
  });
}
