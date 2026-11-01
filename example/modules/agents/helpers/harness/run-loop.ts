import type Anthropic from "@anthropic-ai/sdk";
import type { ToolActor } from "@tulipes/core/agent";

import {
  ModelRejected,
  TERMINAL,
  type ApprovalPolicy,
  type Clock,
  type Identity,
  type ModelClient,
  type ModelTurn,
  type ModuleSummary,
  type PendingCall,
  type ResultFormatter,
  type Run,
  type RunEvents,
  type RunLimits,
  type RunResult,
  type RunStore,
  type ToolDefinition,
  type ToolSource,
  type TrajectoryGuard,
} from "./contracts.ts";
import { HARNESS_TOOLS, NUDGE, RUN_FINISH, RUN_NOTE, parseNote, parseResult } from "./prompt.ts";

export interface LoopSettings {
  /** max_tokens for a turn. */
  maxTokens: number;
  /** The one retry a turn cut off at max_tokens gets. */
  retryMaxTokens: number;
}

export interface RunLoopDeps {
  store: RunStore;
  model: ModelClient;
  tools: ToolSource;
  policy: ApprovalPolicy;
  limits: RunLimits;
  guard: TrajectoryGuard;
  results: ResultFormatter;
  identity: Identity;
  events: RunEvents;
  clock: Clock;
  /** The system prompt for the app's map; the deployment's policy is bound by the composition. */
  system: (modules: readonly ModuleSummary[]) => string;
  settings: LoopSettings;
}

/** What one job works with: fixed for the job, so the prompt prefix stays cached. */
interface Job {
  runId: string;
  actor: ToolActor;
  system: string;
  tools: readonly ToolDefinition[];
  byName: ReadonlyMap<string, ToolDefinition>;
  elapsed: () => number;
  signal: AbortSignal | undefined;
}

/** How one pending call will be answered. */
type Plan =
  | { call: PendingCall; kind: "execute"; tool: ToolDefinition }
  | { call: PendingCall; kind: "harness" }
  | { call: PendingCall; kind: "ask" }
  | { call: PendingCall; kind: "answer"; content: string };

interface Answer {
  content: string;
  isError: boolean;
}

const INTERRUPTED =
  "The previous attempt was interrupted while this call ran, so whether it took effect is unknown. "
  + "Check the current state with a read-only tool before trying it again.";
const UNEXPECTED = "The tool failed unexpectedly and gave no reason. Do not retry it unchanged.";

/**
 * One run, from wherever it stands to where it stops: a terminal status,
 * or `waiting_approval`. The order is the harness's whole contract —
 * budgets and identity before every turn; every turn persisted before any
 * of its tools runs; every call answered, in one message, before the next
 * turn; nothing already sent ever rewritten — and it is all here. What
 * each step does is a collaborator's: this class knows no model, database,
 * queue or HTTP.
 *
 * Calling `run()` again on the same id is always safe. It resumes from the
 * stored state, which is how a retried job and an approved run continue.
 */
export class RunLoop {
  readonly #deps: RunLoopDeps;

  constructor(deps: RunLoopDeps) {
    this.#deps = deps;
  }

  async run(runId: string, signal?: AbortSignal): Promise<Run> {
    const { store, clock } = this.#deps;
    const stored = await store.load(runId);
    if (!stored) throw new Error(`agents: no run ${runId}`);
    if (TERMINAL.has(stored.status)) return stored;

    const startedAt = clock.now();
    const elapsed = () => stored.elapsedMs + (clock.now() - startedAt);

    let run = await store.resume(runId);
    if (TERMINAL.has(run.status)) return run;

    const actor = await this.#identify(run);
    if (!actor) return this.#end(runId, "failed", { reason: "credential_revoked" }, elapsed);

    const catalog = await this.#deps.tools.catalog(actor);
    const tools = [...catalog.tools, ...HARNESS_TOOLS];
    const job: Job = {
      runId,
      actor,
      system: this.#deps.system(catalog.modules),
      tools,
      byName: new Map(tools.map((tool) => [tool.name, tool])),
      elapsed,
      signal,
    };

    if (run.pending.length > 0) {
      const answered = await this.#answer(run, job, { interrupted: run.executing });
      if (answered.stop) return answered.run;
      run = answered.run;
    }

    for (;;) {
      signal?.throwIfAborted();

      const exhausted = this.#deps.limits.check(run, elapsed());
      if (exhausted) {
        await this.#emit({ runId, kind: "limit", outcome: exhausted });
        return this.#end(runId, "exhausted", { reason: exhausted }, elapsed);
      }

      // The person's authority now, not when the run started: a revoked
      // token or a removed user stops the run before it spends anything.
      const current = await this.#identify(run);
      if (!current) return this.#end(runId, "failed", { reason: "credential_revoked" }, elapsed);
      job.actor = current;

      let turn: ModelTurn;
      try {
        turn = await this.#turn(run, job);
      } catch (error) {
        if (error instanceof ModelRejected) return this.#end(runId, "failed", { reason: error.reason }, elapsed);
        throw error;
      }
      if (turn.stopReason === "max_tokens") return this.#end(runId, "failed", { reason: "truncated" }, elapsed);
      if (turn.stopReason === "model_context_window_exceeded") return this.#end(runId, "exhausted", { reason: "context_window" }, elapsed);

      const calls = toolCalls(turn);
      run = await store.appendTurn(runId, turn, calls, elapsed());
      if (TERMINAL.has(run.status)) return run;

      if (turn.stopReason === "refusal") {
        return this.#end(runId, "failed", { reason: turn.refusalCategory ? `refusal:${turn.refusalCategory}` : "refusal" }, elapsed);
      }
      // The server paused its own loop, or compacted the history: either
      // way the turn is appended as it came and the model is asked again.
      if (turn.stopReason === "pause_turn" || turn.stopReason === "compaction") continue;

      if (calls.length > 0) {
        const answered = await this.#answer(run, job, { interrupted: false });
        if (answered.stop) return answered.run;
        run = answered.run;
        continue;
      }

      // The model stopped talking without the completion contract. It is
      // reminded once; a second plain stop is taken as the end, reported
      // as partial because nothing was claimed as verified.
      if (!run.nudged) {
        run = await store.appendNudge(runId, NUDGE);
        if (TERMINAL.has(run.status)) return run;
        continue;
      }
      return this.#end(runId, "succeeded", {
        result: { outcome: "partial", summary: lastText(turn) || "The run ended without a summary.", verification: "The run ended without run_finish; nothing was reported as verified." },
      }, elapsed);
    }
  }

  /** One model turn, with the single retry a turn cut off at max_tokens gets. */
  async #turn(run: Run, job: Job): Promise<ModelTurn> {
    const { model, settings } = this.#deps;
    const request = { system: job.system, tools: job.tools, messages: run.transcript, signal: job.signal };
    const first = await this.#timed(() => model.complete({ ...request, maxTokens: settings.maxTokens }), job);
    if (first.stopReason !== "max_tokens") return first;
    // The truncated turn was never appended, so retrying it rewrites nothing;
    // its tokens were spent all the same and are counted with the retry.
    const retry = await this.#timed(() => model.complete({ ...request, maxTokens: settings.retryMaxTokens }), job);
    return { ...retry, usage: sum(first.usage, retry.usage) };
  }

  async #timed(complete: () => Promise<ModelTurn>, job: Job): Promise<ModelTurn> {
    const started = this.#deps.clock.now();
    const turn = await complete();
    await this.#emit({ runId: job.runId, kind: "model", outcome: turn.stopReason, ms: this.#deps.clock.now() - started, tokens: turn.usage });
    return turn;
  }

  /**
   * Answers every pending call of the last turn in one message — or, when
   * one needs the owner, stops the run at `waiting_approval` without
   * running any of them. On a resume after a crash (`interrupted`), a call
   * that writes is not run again: it may already have taken effect.
   */
  async #answer(run: Run, job: Job, { interrupted }: { interrupted: boolean }): Promise<{ run: Run; stop: boolean }> {
    const { store } = this.#deps;
    const plans = run.pending.map((call) => this.#plan(call, run, job, interrupted));

    const asks = plans.filter((plan) => plan.kind === "ask");
    if (asks.length > 0) {
      for (const { call } of asks) await this.#emit({ runId: job.runId, kind: "policy", tool: call.name, outcome: "ask" });
      return { run: await store.awaitApproval(job.runId, job.elapsed()), stop: true };
    }

    const claimed = await store.beginExecution(job.runId, { takeover: interrupted });
    // Another job is running these calls; running them here too would repeat its writes.
    if (!claimed) return { run: (await store.load(job.runId)) ?? run, stop: true };
    run = claimed;
    if (TERMINAL.has(run.status)) return { run, stop: true };

    const answers = new Map<string, Answer>();
    let finish: RunResult | undefined;

    // Reads together, then writes one at a time in the order the model
    // gave them: a write may depend on the one before it.
    const executes = plans.filter((plan): plan is Extract<Plan, { kind: "execute" }> => plan.kind === "execute");
    await Promise.all(executes.filter(({ tool }) => tool.readOnly).map(async ({ call }) => answers.set(call.id, await this.#execute(call, job))));
    for (const { call } of executes.filter(({ tool }) => !tool.readOnly)) answers.set(call.id, await this.#execute(call, job));

    for (const plan of plans) {
      if (plan.kind === "answer") answers.set(plan.call.id, { content: plan.content, isError: true });
      if (plan.kind !== "harness") continue;
      if (plan.call.name === RUN_NOTE) {
        const text = parseNote(plan.call.input);
        if (text) await store.addNote(job.runId, text);
        answers.set(plan.call.id, text ? { content: "Noted.", isError: false } : { content: "run_note needs a non-empty `text`.", isError: true });
      } else {
        finish = parseResult(plan.call.input);
        answers.set(plan.call.id, finish
          ? { content: "The run is finished.", isError: false }
          : { content: 'run_finish needs `outcome` ("done", "blocked" or "partial"), a non-empty `summary` and `verification`.', isError: true });
      }
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = run.pending.map((call) => {
      const answer = answers.get(call.id)!;
      return { type: "tool_result", tool_use_id: call.id, content: answer.content, ...(answer.isError && { is_error: true }) };
    });
    const trajectory = this.#deps.guard.inspect([...run.transcript, { role: "user", content: results }]);

    run = await store.appendResults(job.runId, results, job.elapsed());
    if (TERMINAL.has(run.status)) return { run, stop: true };

    if (finish) return { run: await this.#end(job.runId, "succeeded", { result: finish }, job.elapsed), stop: true };
    if (trajectory.kind === "fail") {
      await this.#emit({ runId: job.runId, kind: "limit", outcome: "stuck" });
      return { run: await this.#end(job.runId, "failed", { reason: `stuck: ${trajectory.reason}` }, job.elapsed), stop: true };
    }
    if (trajectory.kind === "warn") run = await store.appendOperatorNote(job.runId, trajectory.note);
    return { run, stop: TERMINAL.has(run.status) };
  }

  #plan(call: PendingCall, run: Run, job: Job, interrupted: boolean): Plan {
    if (call.name === RUN_NOTE || call.name === RUN_FINISH) return { call, kind: "harness" };
    const tool = job.byName.get(call.name);
    if (!tool) {
      return { call, kind: "answer", content: `No tool named "${call.name}" is available to this run. Use one of the tools you were given.` };
    }
    if (interrupted && !tool.readOnly) return { call, kind: "answer", content: INTERRUPTED };
    // Own keys only: a call id the model chose must not reach Object.prototype.
    const recorded = Object.hasOwn(run.decisions, call.id) ? run.decisions[call.id] : undefined;
    switch (this.#deps.policy.decide(tool, recorded)) {
      case "allow":
        return { call, kind: "execute", tool };
      case "ask":
        return { call, kind: "ask" };
      case "deny":
        return {
          call,
          kind: "answer",
          content: recorded === "deny"
            ? "Declined by the person who started the run. Explain what you needed it for, or reach the goal another way."
            : "Declined by this application's policy for agent runs.",
        };
    }
  }

  /** Runs one call; whatever happens, the model gets an answer it can read. */
  async #execute(call: PendingCall, job: Job): Promise<Answer> {
    const started = this.#deps.clock.now();
    let outcome;
    try {
      outcome = await this.#deps.tools.call(call.name, call.input, job.actor);
    } catch {
      outcome = { ok: false as const, message: UNEXPECTED };
    }
    await this.#emit({ runId: job.runId, kind: "tool", tool: call.name, outcome: outcome.ok ? "ok" : "error", ms: this.#deps.clock.now() - started });
    return { content: this.#deps.results.shape(outcome), isError: !outcome.ok };
  }

  async #identify(run: Run): Promise<ToolActor | null> {
    const actor = await this.#deps.identity.resolve(run.actor);
    if (!actor) await this.#emit({ runId: run.id, kind: "identity", outcome: "revoked" });
    return actor;
  }

  async #end(runId: string, status: Run["status"], detail: { result?: RunResult; reason?: string }, elapsed: () => number): Promise<Run> {
    const run = await this.#deps.store.end(runId, status, detail, elapsed());
    await this.#emit({ runId, kind: "end", outcome: run.status === status ? (detail.reason ?? status) : run.status });
    return run;
  }

  async #emit(event: Parameters<RunEvents["emit"]>[0]): Promise<void> {
    await this.#deps.events.emit(event);
  }
}

function toolCalls(turn: ModelTurn): PendingCall[] {
  return turn.content
    .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
}

function lastText(turn: ModelTurn): string {
  return turn.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function sum(a: ModelTurn["usage"], b: ModelTurn["usage"]): ModelTurn["usage"] {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}
