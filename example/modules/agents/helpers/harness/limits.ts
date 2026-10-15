import type { Exhaustion, Run, RunLimits } from "./contracts.ts";

export interface Budgets {
  maxTurns: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  maxRunMs: number;
}

/**
 * The run's budgets, checked before every model turn. A run that reaches
 * one ends `exhausted` with its transcript intact; the model is never told
 * to hurry, the owner is told why it stopped.
 */
export class BudgetLimits implements RunLimits {
  readonly #budgets: Budgets;

  constructor(budgets: Budgets) {
    this.#budgets = budgets;
  }

  check(run: Run, elapsedMs: number): Exhaustion | undefined {
    if (run.turns >= this.#budgets.maxTurns) return "max_turns";
    if (run.toolCalls >= this.#budgets.maxToolCalls) return "max_tool_calls";
    if (run.usage.output >= this.#budgets.maxOutputTokens) return "max_output_tokens";
    if (elapsedMs >= this.#budgets.maxRunMs) return "max_run_ms";
    return undefined;
  }
}
