import type { VariableSpec, VariableValue } from "./spec.js";

interface StoredVariable {
  spec: VariableSpec;
  /** Module that owns (declared) this variable. */
  owner: string;
  value: VariableValue;
}

/**
 * The resolved, validated variable store the rest of the framework reads from.
 *
 * Fail-closed on the read side too: asking for a variable no module declared
 * throws immediately instead of returning undefined — an undeclared read is
 * always a bug (either a typo, or a missing meta.variables.json entry), and
 * surfacing it at the call site beats debugging an undefined downstream.
 */
export class VariableStore {
  readonly #variables = new Map<string, StoredVariable>();

  /** @internal Populated by the Environment engine during boot. */
  declare_(spec: VariableSpec, owner: string, value: VariableValue): void {
    this.#variables.set(spec.name, { spec, owner, value });
  }

  has(name: string): boolean {
    return this.#variables.has(name);
  }

  get<T extends VariableValue = VariableValue>(name: string): T {
    const stored = this.#variables.get(name);
    if (!stored) {
      throw new Error(
        `Environment variable "${name}" was never declared by any module's meta.variables.json`,
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
