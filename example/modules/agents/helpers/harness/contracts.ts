import type Anthropic from "@anthropic-ai/sdk";
import type { ToolActor } from "@tulipes/core/agent";

/**
 * The ports of the harness. The run loop depends on these and on nothing
 * concrete: the model, the app's actions, the run's storage, the policy
 * and the identity are each an adapter composed in `queues/`, and a test
 * composes fakes instead. Nothing here is imported at runtime — the SDK
 * is reached for its types only, so the API's own shapes are never
 * redefined.
 */

export type JsonSchema = Record<string, unknown>;

/** What a turn's transcript entries are: the API's message shape, verbatim. */
export type TranscriptMessage = Anthropic.MessageParam;

/** One tool as the model sees it, plus the one fact the policy decides on. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
  /** Changes nothing — declared by the module that owns the action, never inferred. */
  readOnly: boolean;
}

/** A module's one-line description, for the system prompt's map of the app. */
export interface ModuleSummary {
  name: string;
  summary: string;
}

export interface ToolCatalog {
  modules: ModuleSummary[];
  /** Sorted by name, so the prompt prefix is byte-stable and stays cached. */
  tools: ToolDefinition[];
}

/** A tool call's result, or the refusal the model reads and can act on. */
export type ToolOutcome = { ok: true; data: unknown } | { ok: false; message: string };

/** The app's actions for one actor: what it may call, and the call itself. */
export interface ToolSource {
  catalog(actor: ToolActor): Promise<ToolCatalog>;
  call(name: string, input: unknown, actor: ToolActor): Promise<ToolOutcome>;
}

// ── The model ────────────────────────────────────────────────────────

export type StopReason = Anthropic.StopReason;

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelRequest {
  system: string;
  tools: readonly ToolDefinition[];
  messages: readonly TranscriptMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ModelTurn {
  /** Appended to the transcript exactly as received. */
  content: Anthropic.ContentBlock[];
  stopReason: StopReason;
  /** Only on a refusal: the classifier's category, when it gave one. */
  refusalCategory?: string | null;
  usage: TokenUsage;
}

/** One request to the model. Which model, its effort and its caching are the adapter's. */
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelTurn>;
}

// ── The run ──────────────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "exhausted";

export const TERMINAL: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "cancelled", "exhausted"]);

/** Who a run acts for, recorded at creation. Never a credential. */
export interface RunActor {
  userId: string;
  /** The creating credential's scopes, snapshotted: a run only ever narrows. */
  scopes?: readonly string[];
  /** Set when an API token created the run; its revocation ends the run. */
  tokenId?: string;
}

/** A `tool_use` the model asked for that has no `tool_result` yet. */
export interface PendingCall {
  id: string;
  name: string;
  input: unknown;
}

export type Decision = "allow" | "deny";

export type Outcome = "done" | "blocked" | "partial";

/** What `run_finish` reported: the completion contract. */
export interface RunResult {
  outcome: Outcome;
  summary: string;
  verification: string;
}

export interface Run {
  id: string;
  status: RunStatus;
  actor: RunActor;
  /** Append-only: nothing already sent is ever edited or removed. */
  transcript: TranscriptMessage[];
  pending: PendingCall[];
  /** The owner's answers to `waiting_approval`, by tool_use id. */
  decisions: Record<string, Decision>;
  /** Set while a turn's tools run; a resume that finds it set was interrupted mid-call. */
  executing: boolean;
  /** Whether the model was already reminded to finish with run_finish. */
  nudged: boolean;
  turns: number;
  toolCalls: number;
  usage: TokenUsage;
  /** Time spent working, across jobs — never the time spent waiting for approval. */
  elapsedMs: number;
  notes: string[];
  result?: RunResult;
  /** Why a run that did not succeed ended. */
  reason?: string;
}

/**
 * The run's durable state. Every write is one atomic update that returns
 * the run as stored, so the loop never works from a copy that disagrees
 * with the database — a cancellation written by the API is seen at the
 * next write.
 */
export interface RunStore {
  load(runId: string): Promise<Run | null>;
  /** queued | waiting_approval → running; a terminal run is returned unchanged. */
  resume(runId: string): Promise<Run>;
  /** Checkpoint A: the turn, what it asked for, its usage — before any tool runs. */
  appendTurn(runId: string, turn: ModelTurn, pending: PendingCall[], elapsedMs: number): Promise<Run>;
  awaitApproval(runId: string, elapsedMs: number): Promise<Run>;
  beginExecution(runId: string): Promise<Run>;
  /** Checkpoint B: one user message answering every pending call; clears pending and decisions. */
  appendResults(runId: string, results: Anthropic.ToolResultBlockParam[], elapsedMs: number): Promise<Run>;
  /** A mid-conversation operator message (`role: "system"`). */
  appendOperatorNote(runId: string, text: string): Promise<Run>;
  /** The one-time reminder to finish properly, as a user turn (a system message may not follow an assistant turn). */
  appendNudge(runId: string, text: string): Promise<Run>;
  addNote(runId: string, text: string): Promise<Run>;
  /** Terminal; a run already terminal (a cancellation) is returned unchanged. */
  end(runId: string, status: RunStatus, detail: { result?: RunResult; reason?: string }, elapsedMs: number): Promise<Run>;
}

// ── Policy ───────────────────────────────────────────────────────────

export type Verdict = "allow" | "ask" | "deny";

export interface ApprovalPolicy {
  /** `recorded` is the owner's answer when the run waited for one. */
  decide(tool: ToolDefinition, recorded: Decision | undefined): Verdict;
}

/** Why a run stopped short of its goal on a budget. */
export type Exhaustion = "max_turns" | "max_tool_calls" | "max_output_tokens" | "max_run_ms";

export interface RunLimits {
  check(run: Run, elapsedMs: number): Exhaustion | undefined;
}

/** What the trajectory says about the run: carry on, warn the model, or stop it. */
export type Trajectory = { kind: "ok" } | { kind: "warn"; note: string } | { kind: "fail"; reason: string };

export interface TrajectoryGuard {
  /** Over the transcript including the results about to be appended. */
  inspect(transcript: readonly TranscriptMessage[]): Trajectory;
}

/** A tool result as the text the model reads: compact, bounded, honest about what was cut. */
export interface ResultFormatter {
  shape(outcome: ToolOutcome): string;
}

/** The actor at this step, or null when the run may no longer act. */
export interface Identity {
  resolve(actor: RunActor): Promise<ToolActor | null>;
}

// ── Observability and time ───────────────────────────────────────────

export interface StepEvent {
  runId: string;
  kind: "model" | "tool" | "policy" | "limit" | "identity" | "end";
  tool?: string;
  outcome: string;
  ms?: number;
  tokens?: TokenUsage;
}

export interface RunEvents {
  emit(event: StepEvent): void | Promise<void>;
}

export interface Clock {
  now(): number;
}
