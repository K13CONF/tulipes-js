import type Anthropic from "@anthropic-ai/sdk";

import type { TranscriptMessage, Trajectory, TrajectoryGuard } from "./contracts.ts";

export interface TrajectoryThresholds {
  /** The same call, same input, this many times in a row: the model is told. */
  repeatWarn: number;
  /** …and this many: the run is stuck. */
  repeatFail: number;
  /** This many errors in a row from one tool: the run stops. */
  consecutiveErrors: number;
}

export const DEFAULT_THRESHOLDS: TrajectoryThresholds = { repeatWarn: 3, repeatFail: 5, consecutiveErrors: 3 };

interface Call {
  name: string;
  /** The input, serialised with sorted keys so equal inputs compare equal. */
  key: string;
}

/**
 * Two signs a run is not making progress, read from the transcript alone
 * so a resumed job sees exactly what the job before it saw: the same call
 * repeated, and one tool failing again and again.
 */
export class RepetitionGuard implements TrajectoryGuard {
  readonly #thresholds: TrajectoryThresholds;

  constructor(thresholds: TrajectoryThresholds = DEFAULT_THRESHOLDS) {
    this.#thresholds = thresholds;
  }

  inspect(transcript: readonly TranscriptMessage[]): Trajectory {
    const { calls, results } = history(transcript);

    const errors = trailingErrors(results);
    if (errors && errors.count >= this.#thresholds.consecutiveErrors) {
      return { kind: "fail", reason: `"${errors.name}" failed ${errors.count} times in a row` };
    }

    const last = calls.at(-1);
    if (!last) return { kind: "ok" };
    let repeats = 0;
    for (let index = calls.length - 1; index >= 0 && calls[index]!.key === last.key; index--) repeats++;
    // The name is the model's text, and the warning is an operator note the model is told to follow:
    // quote it only when it has a tool name's shape.
    const name = /^[A-Za-z0-9_-]{1,64}$/.test(last.name) ? `"${last.name}"` : "the same tool";
    if (repeats >= this.#thresholds.repeatFail) return { kind: "fail", reason: `${name} called ${repeats} times in a row with the same input` };
    if (repeats >= this.#thresholds.repeatWarn) {
      return {
        kind: "warn",
        note: `${name} has now been called ${repeats} times in a row with the same input. The same call returns the same result: change the input, use another tool, or finish with run_finish.`,
      };
    }
    return { kind: "ok" };
  }
}

function history(transcript: readonly TranscriptMessage[]): { calls: Call[]; results: { name: string; error: boolean }[] } {
  const calls: Call[] = [];
  const names = new Map<string, string>();
  const results: { name: string; error: boolean }[] = [];
  for (const message of transcript) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") {
        const use = block as Anthropic.Beta.BetaToolUseBlockParam;
        names.set(use.id, use.name);
        calls.push({ name: use.name, key: `${use.name}:${stableJson(use.input)}` });
      } else if (block.type === "tool_result") {
        const result = block as Anthropic.Beta.BetaToolResultBlockParam;
        results.push({ name: names.get(result.tool_use_id) ?? "", error: result.is_error === true });
      }
    }
  }
  return { calls, results };
}

/** The tool whose latest results are all errors, and how many there are in a row. */
function trailingErrors(results: readonly { name: string; error: boolean }[]): { name: string; count: number } | undefined {
  const last = results.at(-1);
  if (!last?.error) return undefined;
  let count = 0;
  for (let index = results.length - 1; index >= 0; index--) {
    const result = results[index]!;
    if (result.name !== last.name) continue;
    if (!result.error) break;
    count++;
  }
  return { name: last.name, count };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
