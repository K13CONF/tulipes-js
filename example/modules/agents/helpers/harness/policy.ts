import type { ApprovalPolicy, Decision, ToolDefinition, Verdict } from "./contracts.ts";

export type ApprovalMode = "none" | "writes" | "all";

/**
 * Which calls wait for the person who started the run. The risk rating is
 * the action's own `readOnly`, declared by the module that owns it: a call
 * that writes is treated as one that cannot be undone until a module can
 * say more. An answer the owner already gave always wins.
 */
export class ModeApprovalPolicy implements ApprovalPolicy {
  readonly #mode: ApprovalMode;

  constructor(mode: ApprovalMode) {
    this.#mode = mode;
  }

  decide(tool: ToolDefinition, recorded: Decision | undefined): Verdict {
    if (recorded) return recorded;
    if (this.#mode === "none") return "allow";
    if (this.#mode === "writes" && tool.readOnly) return "allow";
    return "ask";
  }
}
