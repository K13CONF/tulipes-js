import type { Model } from "mongoose";

/**
 * Global model registry, populated from every module's `models/*.model.ts`
 * during phase 8.
 *
 * Same fail-closed read contract as the variable store: asking for a model
 * nobody registered throws at the call site — a typo'd model name must never
 * travel as an undefined into query code.
 */
export class ModelStore {
  /** name → { model, owning module } */
  readonly #models = new Map<string, { model: Model<never>; owner: string }>();

  /** @internal Database loader only. */
  register_(name: string, model: Model<never>, owner: string): void {
    this.#models.set(name, { model, owner });
  }

  has(name: string): boolean {
    return this.#models.has(name);
  }

  ownerOf(name: string): string | undefined {
    return this.#models.get(name)?.owner;
  }

  names(): string[] {
    return [...this.#models.keys()];
  }

  /**
   * The generic is a caller-side assertion — the store can't verify it.
   * Typed accessors per model come with the `tulipes sync` codegen.
   */
  get<T = unknown>(name: string): Model<T> {
    const stored = this.#models.get(name);
    if (!stored) {
      throw new Error(
        `Model "${name}" was never registered by any module (known: ${this.names().join(", ") || "none"})`,
      );
    }
    return stored.model as unknown as Model<T>;
  }
}
