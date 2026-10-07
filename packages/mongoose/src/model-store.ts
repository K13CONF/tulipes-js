import type { Connection, Model } from "mongoose";

import type { ModelsCapability } from "@tulipes/core/boot";

import type { KnownModel, KnownModelName } from "./index.js";

/**
 * What `ctx.models` is once this provider is in the compilation. Core's
 * ModelsCapability is empty; an app that imports anything from this package
 * (its model files do, for ModelDef) sees these members typed.
 */
declare module "@tulipes/core/boot" {
  interface ModelsCapability {
    has(name: string): boolean;
    ownerOf(name: string): string | undefined;
    names(): string[];
    /**
     * A name `tulipes sync` found in a model file is typed from that file's
     * schema; any other string — a dynamic name, or an app that has not run
     * sync — gets the caller-side generic, which the store cannot verify.
     */
    get<N extends KnownModelName>(name: N): KnownModel<N>;
    get<T = unknown>(name: string): Model<T>;
    /** The boot's own connection, for scripts and tests that need the driver. */
    readonly connection: Connection;
  }
}

/**
 * Model registry for one boot, populated from every module's
 * `models/*.model.ts` during phase 8.
 *
 * Same fail-closed read contract as the variable store: asking for a model
 * nobody registered throws at the call site — a typo'd model name must never
 * travel as an undefined into query code.
 */
export class ModelStore implements ModelsCapability {
  /** name → { model, owning module } */
  readonly #models = new Map<string, { model: Model<never>; owner: string }>();

  constructor(readonly connection: Connection) {}

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

  get<N extends KnownModelName>(name: N): KnownModel<N>;
  get<T = unknown>(name: string): Model<T>;
  /** The generic is a caller-side assertion — the store can't verify it. */
  get(name: string): Model<unknown> {
    const stored = this.#models.get(name);
    if (!stored) {
      throw new Error(
        `Model "${name}" was never registered by any module (known: ${this.names().join(", ") || "none"})`,
      );
    }
    return stored.model as unknown as Model<unknown>;
  }
}
