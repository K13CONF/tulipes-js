import type Anthropic from "@anthropic-ai/sdk";

import {
  TERMINAL,
  type ModelTurn,
  type PendingCall,
  type Run,
  type RunActor,
  type RunResult,
  type RunStatus,
  type RunStore,
  type TranscriptMessage,
} from "../../helpers/harness/contracts.ts";

/**
 * The RunStore contract in memory, for the harness suite. Every read and
 * every write returns a deep copy, as a database would: a loop that
 * mutated what it was handed would change nothing here, and the suite
 * would see it. `writes` keeps the transcript after every write, which is
 * what the append-only test reads.
 */
export class MemoryRunStore implements RunStore {
  readonly #runs = new Map<string, Run>();
  readonly writes: TranscriptMessage[][] = [];

  create(id: string, transcript: TranscriptMessage[], actor: RunActor = { userId: "u1" }): Run {
    const run: Run = {
      id,
      status: "queued",
      actor,
      transcript,
      pending: [],
      decisions: {},
      executing: false,
      nudged: false,
      turns: 0,
      toolCalls: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      elapsedMs: 0,
      notes: [],
    };
    this.#runs.set(id, structuredClone(run));
    return structuredClone(run);
  }

  /** What the API does: the owner's answers, or a cancellation, written beside the loop. */
  decide(id: string, decisions: Run["decisions"]): void {
    this.#update(id, (run) => { run.decisions = { ...run.decisions, ...decisions }; });
  }

  cancel(id: string): void {
    this.#update(id, (run) => { if (!TERMINAL.has(run.status)) run.status = "cancelled"; });
  }

  /** A test arranging a state the loop would have left behind (a crash mid-call). */
  patch(id: string, change: (run: Run) => void): void {
    this.#update(id, change);
  }

  async load(runId: string): Promise<Run | null> {
    const run = this.#runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async resume(runId: string): Promise<Run> {
    return this.#update(runId, (run) => { if (!TERMINAL.has(run.status)) run.status = "running"; });
  }

  async appendTurn(runId: string, turn: ModelTurn, pending: PendingCall[], elapsedMs: number): Promise<Run> {
    return this.#append(runId, (run) => {
      run.transcript.push({ role: "assistant", content: turn.content });
      run.pending = pending;
      run.turns += 1;
      run.usage = {
        input: run.usage.input + turn.usage.input,
        output: run.usage.output + turn.usage.output,
        cacheRead: run.usage.cacheRead + turn.usage.cacheRead,
        cacheWrite: run.usage.cacheWrite + turn.usage.cacheWrite,
      };
      run.elapsedMs = elapsedMs;
    });
  }

  async awaitApproval(runId: string, elapsedMs: number): Promise<Run> {
    return this.#update(runId, (run) => {
      if (TERMINAL.has(run.status)) return;
      run.status = "waiting_approval";
      run.elapsedMs = elapsedMs;
    });
  }

  async beginExecution(runId: string, { takeover = false } = {}): Promise<Run | null> {
    const current = this.#runs.get(runId);
    if (current && current.executing && !takeover && !TERMINAL.has(current.status)) return null;
    return this.#update(runId, (run) => { if (!TERMINAL.has(run.status)) run.executing = true; });
  }

  async appendResults(runId: string, results: Anthropic.Beta.BetaToolResultBlockParam[], elapsedMs: number): Promise<Run> {
    return this.#append(runId, (run) => {
      run.transcript.push({ role: "user", content: results });
      run.toolCalls += results.length;
      run.pending = [];
      run.decisions = {};
      run.executing = false;
      run.elapsedMs = elapsedMs;
    });
  }

  async appendOperatorNote(runId: string, text: string): Promise<Run> {
    return this.#append(runId, (run) => { run.transcript.push({ role: "system", content: text }); });
  }

  async appendNudge(runId: string, text: string): Promise<Run> {
    return this.#append(runId, (run) => {
      run.transcript.push({ role: "user", content: text });
      run.nudged = true;
    });
  }

  async addNote(runId: string, text: string): Promise<Run> {
    return this.#update(runId, (run) => { run.notes.push(text); });
  }

  async end(runId: string, status: RunStatus, detail: { result?: RunResult; reason?: string }, elapsedMs: number): Promise<Run> {
    return this.#update(runId, (run) => {
      if (TERMINAL.has(run.status)) return;
      run.status = status;
      if (detail.result) run.result = detail.result;
      if (detail.reason) run.reason = detail.reason;
      run.elapsedMs = elapsedMs;
    });
  }

  #append(runId: string, change: (run: Run) => void): Run {
    const run = this.#update(runId, change);
    this.writes.push(structuredClone(run.transcript));
    return run;
  }

  #update(runId: string, change: (run: Run) => void): Run {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`no run ${runId}`);
    change(run);
    return structuredClone(run);
  }
}
