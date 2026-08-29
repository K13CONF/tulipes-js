/**
 * Forgex fails closed at boot: a phase never crashes on the first problem it
 * meets. It collects everything wrong, then throws once with the full list —
 * so a developer with ten missing env variables fixes ten, not one per restart.
 */

export type BootScope = "env" | "modules" | "config" | "acl" | "boot";

export interface BootIssue {
  scope: BootScope;
  /** Module short-name, when the issue is attributable to a single module. */
  module?: string;
  message: string;
}

export class ForgexBootError extends Error {
  readonly phase: string;
  readonly issues: readonly BootIssue[];

  constructor(phase: string, issues: readonly BootIssue[]) {
    super(ForgexBootError.#format(phase, issues));
    this.name = "ForgexBootError";
    this.phase = phase;
    this.issues = issues;
  }

  static #format(phase: string, issues: readonly BootIssue[]): string {
    const lines = issues.map((issue) => {
      const origin = issue.module ? `[${issue.module}] ` : "";
      return `  ✖ ${origin}${issue.message}`;
    });
    return [
      `Boot aborted during "${phase}" — ${issues.length} issue(s):`,
      ...lines,
    ].join("\n");
  }
}

/**
 * Shared collector passed through a boot phase. Engines `add()` freely;
 * the phase driver calls `throwIfAny()` at its checkpoint.
 */
export class BootReport {
  readonly #issues: BootIssue[] = [];

  add(issue: BootIssue): void {
    this.#issues.push(issue);
  }

  get issues(): readonly BootIssue[] {
    return this.#issues;
  }

  throwIfAny(phase: string): void {
    if (this.#issues.length > 0) {
      throw new ForgexBootError(phase, this.#issues);
    }
  }
}
