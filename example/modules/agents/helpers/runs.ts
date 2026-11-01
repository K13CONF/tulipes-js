import type { RuntimeCtx } from "@tulipes/core/boot";
import { requireModels, requireQueues } from "@tulipes/core/boot";
import { HttpError, type Auth } from "@tulipes/core/http";

import type { RunDocument } from "./adapters/mongo-run-store.ts";
import { agentsConfigured } from "./compose.ts";
import { TERMINAL, type Decision } from "./harness/contracts.ts";
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
export async function startRun(ctx: RuntimeCtx, auth: Auth, input: StartRun) {
  if (!agentsConfigured(ctx)) {
    throw new HttpError(503, "agentUnconfigured", { code: "AGENT_UNCONFIGURED", defaultMessage: "agent runs are not configured on this deployment" });
  }
  if (!auth.isAuthenticated || !auth.user) throw new HttpError(401, "unauthenticated", { code: "UNAUTHENTICATED", defaultMessage: "authentication required" });

  const created = await requireModels(ctx).get("AgentRun").create({
    user: (auth.user as { _id: unknown })._id,
    ...(auth.scopes && { scopes: [...auth.scopes] }),
    ...(auth.credentialId && { token_id: auth.credentialId }),
    // A session-started run is bound to that session, so it ends with it.
    ...(!auth.credentialId && auth.session?.sid && { session_id: auth.session.sid }),
    goal: input.goal,
    transcript: [openingMessage(input.goal, input.context)],
    status: "queued",
    segment: 1,
  });
  await enqueue(ctx, String(created._id), 1);
  return summaryOf(ctx, created.toObject() as unknown as RunDocument);
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

/** Whose runs a caller reaches: their own, or — in the back office — any (`null`). */
export type Owner = string | null;

/** The caller's user id, for the owner filter. */
export function ownerOf(auth: Auth): string {
  const id = (auth.user as { _id?: unknown } | null)?._id;
  if (!auth.isAuthenticated || id === undefined) throw new HttpError(401, "unauthenticated", { code: "UNAUTHENTICATED", defaultMessage: "authentication required" });
  return String(id);
}

export async function listRuns(ctx: RuntimeCtx, owner: Owner, query: { skip: number; limit: number; status?: string }) {
  const filter = { ...(owner && { user: owner }), ...(query.status && { status: query.status }) };
  const runs = requireModels(ctx).get("AgentRun");
  const [docs, total] = await Promise.all([
    runs.find(filter).select("-transcript -steps -notes").sort({ created_at: -1 }).skip(query.skip).limit(query.limit).lean<RunDocument[]>(),
    runs.countDocuments(filter),
  ]);
  return { runs: docs.map((doc) => summaryOf(ctx, doc)), total };
}

export async function readRun(ctx: RuntimeCtx, owner: Owner, runId: string) {
  return detailOf(ctx, await find(ctx, owner, runId));
}

/**
 * Ends a run that has not ended. A job working on it sees the status at its
 * next write and stops there; a queued or waiting run is simply over.
 */
export async function cancelRun(ctx: RuntimeCtx, owner: Owner, runId: string) {
  const doc = await requireModels(ctx).get("AgentRun").findOneAndUpdate(
    { _id: runId, ...(owner && { user: owner }), status: { $nin: [...TERMINAL] } },
    { $set: { status: "cancelled", reason: "cancelled", executing: false, expires_at: expiry(ctx) } },
    { new: true },
  ).lean<RunDocument>();
  if (doc) return summaryOf(ctx, doc);
  await find(ctx, owner, runId);
  throw new HttpError(409, "runEnded", { code: "RUN_ENDED", defaultMessage: "the run has already ended" });
}

/**
 * The owner's answers to a run waiting for approval: one per waiting call,
 * no more, no fewer. The run is queued again in the same write, and its
 * next segment's job enqueued — so two approvals sent at once give one job.
 */
export async function approveRun(ctx: RuntimeCtx, owner: string, runId: string, decisions: Record<string, Decision>) {
  const current = await find(ctx, owner, runId);
  if (current.status !== "waiting_approval") {
    throw new HttpError(409, "runNotWaiting", { code: "RUN_NOT_WAITING", defaultMessage: "the run is not waiting for approval" });
  }
  const waiting = new Set(current.pending.map((call) => call.id));
  const answered = Object.keys(decisions);
  const unknown = answered.filter((id) => !waiting.has(id));
  const missing = [...waiting].filter((id) => !(id in decisions));
  if (unknown.length || missing.length) {
    throw new HttpError(422, "decisionsIncomplete", {
      code: "DECISIONS_INCOMPLETE",
      field: "decisions",
      defaultMessage: "answer every waiting call, and only those",
      details: { missing, unknown },
    });
  }
  const doc = await requireModels(ctx).get("AgentRun").findOneAndUpdate(
    { _id: runId, user: owner, status: "waiting_approval" },
    { $set: { decisions, status: "queued" }, $inc: { segment: 1 } },
    { new: true },
  ).lean<RunDocument>();
  if (!doc) throw new HttpError(409, "runNotWaiting", { code: "RUN_NOT_WAITING", defaultMessage: "the run is not waiting for approval" });
  await enqueue(ctx, runId, doc.segment);
  return summaryOf(ctx, doc);
}

async function find(ctx: RuntimeCtx, owner: Owner, runId: string): Promise<RunDocument> {
  const doc = await requireModels(ctx).get("AgentRun").findOne({ _id: runId, ...(owner && { user: owner }) }).lean<RunDocument>();
  // Another user's run is "not found", never "forbidden": its existence is not theirs to learn.
  if (!doc) throw new HttpError(404, "noSuchRun", { code: "NO_SUCH_RUN", field: "run_id", defaultMessage: "no such run" });
  return doc;
}

function expiry(ctx: RuntimeCtx): Date {
  return new Date(Date.now() + ctx.config.agents!.retentionDays * 86_400_000);
}

/** The run on the wire: snake_case, no transcript, and — when it waits — what it waits on. */
export function summaryOf(ctx: RuntimeCtx, doc: RunDocument) {
  return {
    id: String(doc._id),
    goal: doc.goal,
    status: doc.status,
    turns: doc.turns,
    tool_calls: doc.tool_calls,
    usage: doc.usage,
    ...(doc.result && { result: { outcome: doc.result.outcome, summary: doc.result.summary, verification: doc.result.verification } }),
    ...(doc.reason && { reason: doc.reason }),
    ...(doc.status === "waiting_approval" && {
      waiting_on: doc.pending.map((call) => ({
        id: call.id,
        tool: call.name,
        description: ctx.agent.find(call.name)?.description ?? "",
        input: call.input,
      })),
    }),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function detailOf(ctx: RuntimeCtx, doc: RunDocument) {
  return { ...summaryOf(ctx, doc), notes: doc.notes, steps: doc.steps, transcript: doc.transcript };
}
