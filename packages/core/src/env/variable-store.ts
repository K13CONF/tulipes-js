import type { VariableSpec, VariableValue } from "./spec.js";

/**
 * Which of the three sources supplied the value, in precedence order.
 *
 * Recorded because it is not recoverable afterwards, and anything that
 * writes a value back has to know: a variable injected by the container
 * cannot be changed by editing a file, and one still on its default has
 * no file entry to edit yet.
 */
export type VariableSource = "process.env" | "file" | "default";

export interface StoredVariable {
  spec: VariableSpec;
  /** Module that owns (declared) this variable. */
  owner: string;
  value: VariableValue;
  source: VariableSource;
}

/**
 * The resolved, validated variable store the rest of the framework reads from.
 *
 * Fail-closed on the read side too: asking for a variable no module declared
 * throws immediately instead of returning undefined — an undeclared read is
 * always a bug (either a typo, or a missing tulipes.env entry in the module's package.json), and
 * surfacing it at the call site beats debugging an undefined downstream.
 */
export class VariableStore {
  readonly #variables = new Map<string, StoredVariable>();

  /** @internal Populated by the Environment engine during boot. */
  declare_(
    spec: VariableSpec,
    owner: string,
    value: VariableValue,
    source: VariableSource,
  ): void {
    this.#variables.set(spec.name, { spec, owner, value, source });
  }

  has(name: string): boolean {
    return this.#variables.has(name);
  }

  get<T extends VariableValue = VariableValue>(name: string): T {
    const stored = this.#variables.get(name);
    if (!stored) {
      throw new Error(
        `Environment variable "${name}" was never declared by any module (package.json tulipes.env)`,
      );
    }
    return stored.value as T;
  }

  /** Runtime override — primarily for tests. The variable must be declared. */
  set(name: string, value: VariableValue): void {
    const stored = this.#variables.get(name);
    if (!stored) {
      throw new Error(`Cannot set undeclared environment variable "${name}"`);
    }
    stored.value = value;
  }

  ownerOf(name: string): string | undefined {
    return this.#variables.get(name)?.owner;
  }

  sourceOf(name: string): VariableSource | undefined {
    return this.#variables.get(name)?.source;
  }

  /**
   * Every declared variable with its spec, owner, value and source — what
   * a settings console needs to render a form and decide where a write
   * lands. Secrets carry `value: undefined`; nothing but an explicit
   * reveal should ever produce one.
   */
  describe(options: { revealSecrets?: boolean } = {}): DescribedVariable[] {
    return [...this.#variables.values()].map(({ spec, owner, value, source }) => ({
      spec,
      owner,
      source,
      isSecret: spec.type === "secret",
      value: spec.type === "secret" && !options.revealSecrets ? undefined : value,
      isSet: value !== undefined,
    }));
  }

  /**
   * Flat view for logging / debugging. Secrets are redacted by default and
   * opting out is deliberately loud in the caller's code.
   */
  snapshot(options: { revealSecrets?: boolean } = {}): Record<string, VariableValue> {
    const view: Record<string, VariableValue> = {};
    for (const [name, { spec, value }] of this.#variables) {
      view[name] =
        spec.type === "secret" && !options.revealSecrets ? "•••" : value;
    }
    return view;
  }
}

export interface DescribedVariable {
  spec: VariableSpec;
  owner: string;
  source: VariableSource;
  isSecret: boolean;
  /** Absent for a secret unless explicitly revealed. */
  value: VariableValue | undefined;
  isSet: boolean;
}
