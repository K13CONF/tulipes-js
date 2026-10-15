import type Anthropic from "@anthropic-ai/sdk";
import { requireModels, type Ctx } from "@tulipes/core/boot";

import {
  TERMINAL,
  type ModelTurn,
  type PendingCall,
  type Run,
  type RunEvents,
  type RunResult,
  type RunStatus,
  type RunStore,
  type StepEvent,
} from "../harness/contracts.ts";

/** The stored shape: snake_case, as every persisted name in the app. */
export interface RunDocument {
  _id: unknown;
  user: unknown;
  scopes?: string[];
  token_id?: string;
  goal: string;
  status: RunStatus;
  transcript: Run["transcript"];
  pending: PendingCall[];
  decisions?: Run["decisions"];
  executing: boolean;
  nudged: boolean;
  turns: number;
  tool_calls: number;
  usage: { input: number; output: number; cache_read: number; cache_write: number };
  elapsed_ms: number;
  notes: string[];
  result?: RunResult;
  reason?: string;
  steps: unknown[];
  segment: number;
  created_at?: Date;
  updated_at?: Date;
}

const ENDED = [...TERMINAL];

/**
 * The RunStore over the AgentRun model. Every write is one atomic
 * `findOneAndUpdate` returning the stored document, so the loop always
 * works from what is in the database — a cancellation the API wrote is in
 * the next result. A write that must not touch an ended run says so in its
 * filter, and an ended run is returned as it is.
 */
export class MongoRunStore implements RunStore {
  readonly #ctx: Ctx;
  readonly #retentionDays: number;

  constructor(ctx: Ctx, options: { retentionDays: number }) {
    this.#ctx = ctx;
    this.#retentionDays = options.retentionDays;
  }

  async load(runId: string): Promise<Run | null> {
    const doc = await this.#runs().findById(runId).lean<RunDocument>();
    return doc ? toRun(doc) : null;
  }

  resume(runId: string): Promise<Run> {
    return this.#write(runId, { $set: { status: "running" } }, { live: true });
  }

  appendTurn(runId: string, turn: ModelTurn, pending: PendingCall[], elapsedMs: number): Promise<Run> {
    return this.#write(runId, {
      $push: { transcript: { role: "assistant", content: turn.content } },
      $set: { pending, elapsed_ms: elapsedMs },
      $inc: {
        turns: 1,
        "usage.input": turn.usage.input,
        "usage.output": turn.usage.output,
        "usage.cache_read": turn.usage.cacheRead,
        "usage.cache_write": turn.usage.cacheWrite,
      },
    });
  }

  awaitApproval(runId: string, elapsedMs: number): Promise<Run> {
    return this.#write(runId, { $set: { status: "waiting_approval", elapsed_ms: elapsedMs } }, { live: true });
  }

  beginExecution(runId: string): Promise<Run> {
    return this.#write(runId, { $set: { executing: true } }, { live: true });
  }

  appendResults(runId: string, results: Anthropic.Beta.BetaToolResultBlockParam[], elapsedMs: number): Promise<Run> {
    return this.#write(runId, {
      $push: { transcript: { role: "user", content: results } },
      $set: { pending: [], decisions: {}, executing: false, elapsed_ms: elapsedMs },
      $inc: { tool_calls: results.length },
    });
  }

  appendOperatorNote(runId: string, text: string): Promise<Run> {
    return this.#write(runId, { $push: { transcript: { role: "system", content: text } } });
  }

  appendNudge(runId: string, text: string): Promise<Run> {
    return this.#write(runId, { $push: { transcript: { role: "user", content: text } }, $set: { nudged: true } });
  }

  addNote(runId: string, text: string): Promise<Run> {
    return this.#write(runId, { $push: { notes: text } });
  }

  end(runId: string, status: RunStatus, detail: { result?: RunResult; reason?: string }, elapsedMs: number): Promise<Run> {
    return this.#write(runId, {
      $set: {
        status,
        executing: false,
        elapsed_ms: elapsedMs,
        expires_at: new Date(Date.now() + this.#retentionDays * 86_400_000),
        ...(detail.result && { result: detail.result }),
        ...(detail.reason && { reason: detail.reason }),
      },
    }, { live: true });
  }

  /** `live`: only while the run has not ended; an ended run is returned untouched. */
  async #write(runId: string, update: Record<string, unknown>, { live = false } = {}): Promise<Run> {
    const filter = live ? { _id: runId, status: { $nin: ENDED } } : { _id: runId };
    const doc = await this.#runs().findOneAndUpdate(filter, update, { new: true }).lean<RunDocument>();
    if (doc) return toRun(doc);
    const current = await this.load(runId);
    if (!current) throw new Error(`agents: no run ${runId}`);
    return current;
  }

  #runs() {
    return requireModels(this.#ctx).get("AgentRun");
  }
}

/** The run's timeline: each step appended to the document, the last 200 kept. */
export class MongoStepLog implements RunEvents {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  async emit({ runId, ...step }: StepEvent): Promise<void> {
    await requireModels(this.#ctx).get("AgentRun").updateOne(
      { _id: runId },
      { $push: { steps: { $each: [{ ...step, at: new Date() }], $slice: -200 } } },
    );
  }
}

export function toRun(doc: RunDocument): Run {
  return {
    id: String(doc._id),
    status: doc.status,
    actor: {
      userId: String(doc.user),
      ...(doc.scopes && { scopes: doc.scopes }),
      ...(doc.token_id && { tokenId: doc.token_id }),
    },
    transcript: doc.transcript,
    pending: doc.pending,
    decisions: doc.decisions ?? {},
    executing: doc.executing,
    nudged: doc.nudged,
    turns: doc.turns,
    toolCalls: doc.tool_calls,
    usage: { input: doc.usage.input, output: doc.usage.output, cacheRead: doc.usage.cache_read, cacheWrite: doc.usage.cache_write },
    elapsedMs: doc.elapsed_ms,
    notes: doc.notes,
    ...(doc.result && { result: { outcome: doc.result.outcome, summary: doc.result.summary, verification: doc.result.verification } }),
    ...(doc.reason && { reason: doc.reason }),
  };
}
