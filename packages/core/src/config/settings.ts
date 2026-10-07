import type { z } from "zod/v4";

import type { Ctx } from "../boot/contracts.ts";
import { BootReport } from "../errors/boot-error.ts";
import {
  declarationJsonSchema,
  declarationProblems,
  restartFields,
  type ConfigDeclaration,
} from "./define-config.ts";
import { SYSTEM_ACTOR, type Actor, type SettingsStore, type StoredSettings } from "./settings-store.ts";

/** A write the schema refuses, with the same issue shape request validation uses. */
export class SettingsValidationError extends Error {
  readonly namespace: string;
  readonly issues: readonly { path: PropertyKey[]; message: string }[];

  constructor(namespace: string, issues: readonly { path: PropertyKey[]; message: string }[]) {
    super(`settings "${namespace}": ${issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
    this.name = "SettingsValidationError";
    this.namespace = namespace;
    this.issues = issues;
  }
}

export interface SettingsWrite {
  values: Record<string, unknown>;
  version: number;
  /** Fields tagged restart whose stored value now differs from the one this process runs with. */
  requiresRestart: string[];
}

export interface SettingsDescription {
  module: string;
  schema: Record<string, unknown>;
  /** What this process runs with. */
  values: Record<string, unknown>;
  /** What the store holds; differs from `values` only in restart-tagged fields. */
  stored: { values: Record<string, unknown>; version: number; updated_at: string; updated_by: Actor };
  restart: string[];
  pendingRestart: string[];
}

/**
 * What `ctx.settings` is: the write side and the inspection side of the
 * settings store, for the console module and for tooling. Reads go
 * through `ctx.config.<module>`, which this manager keeps live.
 */
export interface SettingsApi {
  namespaces(): string[];
  describe(namespace: string): SettingsDescription;
  /** Validate `patch` over the stored values, persist, apply, run the module's onChange. */
  set(namespace: string, patch: Record<string, unknown>, actor: Actor): Promise<SettingsWrite>;
  /** The store behind it, for the banner. */
  status(): { label: string; ready: boolean };
}

interface Declared {
  module: string;
  declaration: ConfigDeclaration;
  restart: Set<string>;
  stored: StoredSettings;
}

/**
 * Boot phase 6 and everything after it: load every declared namespace from
 * the store, seed what was never written, validate, hand the values to
 * `ctx.config`, and keep them live — through `set()` from this process and
 * through the store's watch from any other.
 */
export class Settings implements SettingsApi {
  readonly #declarations = new Map<string, { module: string; declaration: ConfigDeclaration }>();
  readonly #live = new Map<string, Declared>();
  #store: SettingsStore | undefined;
  #unwatch: (() => void) | undefined;
  #ctx: Ctx | undefined;

  /** @internal Phase 4. */
  declare_(module: string, declaration: ConfigDeclaration, report: BootReport): void {
    for (const problem of declarationProblems(declaration)) {
      report.add({ scope: "config", module, message: `module.config: ${problem}` });
    }
    this.#declarations.set(module, { module, declaration });
  }

  /** @internal Phase 6. */
  async load(store: SettingsStore, ctx: Ctx, report: BootReport): Promise<void> {
    this.#store = store;
    this.#ctx = ctx;
    for (const [namespace, { module, declaration }] of this.#declarations) {
      let stored: StoredSettings | undefined;
      try {
        stored = await store.load(namespace);
      } catch (error) {
        report.add({ scope: "config", module, message: `settings could not be read: ${(error as Error).message}` });
        continue;
      }
      const parsed = declaration.schema.safeParse(stored?.values ?? {});
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          report.add({ scope: "config", module, message: `stored setting "${[namespace, ...issue.path].join(".")}": ${issue.message} (fix it in the store, or ${store.status().label})` });
        }
        continue;
      }
      const values = parsed.data as Record<string, unknown>;
      if (!stored) {
        try {
          stored = await store.save(namespace, values, 0, SYSTEM_ACTOR);
        } catch (error) {
          // Another process seeded first; its values are the ones that count.
          stored = await store.load(namespace);
          if (!stored) {
            report.add({ scope: "config", module, message: `settings could not be seeded: ${(error as Error).message}` });
            continue;
          }
          const reparsed = declaration.schema.safeParse(stored.values);
          if (!reparsed.success) {
            report.add({ scope: "config", module, message: `stored setting "${namespace}" written by another process is invalid: ${reparsed.error.issues[0]?.message}` });
            continue;
          }
          Object.assign(values, reparsed.data as Record<string, unknown>);
        }
      }
      ctx.config[namespace] = { ...values };
      this.#live.set(namespace, { module, declaration, restart: new Set(restartFields(declaration)), stored });
    }
    if (report.issues.length === 0 && store.watch) {
      this.#unwatch = store.watch((namespace, incoming) => void this.#incoming(namespace, incoming));
    }
  }

  namespaces(): string[] {
    return [...this.#live.keys()];
  }

  describe(namespace: string): SettingsDescription {
    const live = this.#require(namespace);
    const values = this.#ctx!.config[namespace] as Record<string, unknown>;
    return {
      module: live.module,
      schema: declarationJsonSchema(live.declaration),
      values: { ...values },
      stored: { values: { ...live.stored.values }, version: live.stored.version, updated_at: live.stored.updated_at, updated_by: live.stored.updated_by },
      restart: [...live.restart],
      pendingRestart: this.#pending(live, values),
    };
  }

  async set(namespace: string, patch: Record<string, unknown>, actor: Actor): Promise<SettingsWrite> {
    const live = this.#require(namespace);
    const parsed = live.declaration.schema.safeParse({ ...live.stored.values, ...patch });
    if (!parsed.success) throw new SettingsValidationError(namespace, parsed.error.issues);
    const values = parsed.data as Record<string, unknown>;
    live.stored = await this.#store!.save(namespace, values, live.stored.version, actor);
    await this.#apply(live, namespace, values);
    return { values: { ...live.stored.values }, version: live.stored.version, requiresRestart: this.#pending(live, this.#ctx!.config[namespace] as Record<string, unknown>) };
  }

  status(): { label: string; ready: boolean } {
    return this.#store?.status() ?? { label: "not loaded", ready: false };
  }

  /** @internal Shutdown. */
  dispose(): void {
    this.#unwatch?.();
    this.#unwatch = undefined;
  }

  async #incoming(namespace: string, incoming: StoredSettings): Promise<void> {
    const live = this.#live.get(namespace);
    if (!live || incoming.version <= live.stored.version) return;
    const parsed = live.declaration.schema.safeParse(incoming.values);
    if (!parsed.success) {
      console.error(`[tulipes] settings "${namespace}" version ${incoming.version} ignored: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      return;
    }
    live.stored = incoming;
    try {
      await this.#apply(live, namespace, parsed.data as Record<string, unknown>);
    } catch (error) {
      console.error(`[tulipes] settings "${namespace}" onChange failed: ${(error as Error).message}`);
    }
  }

  /**
   * Hot fields replace the live values in place, so a holder of
   * `ctx.config.<module>` sees the change; restart-tagged fields keep what
   * this process booted with until it boots again.
   */
  async #apply(live: Declared, namespace: string, next: Record<string, unknown>): Promise<void> {
    const target = this.#ctx!.config[namespace] as Record<string, unknown>;
    const applied = { ...next };
    for (const field of live.restart) if (field in target) applied[field] = target[field];
    for (const key of Object.keys(target)) if (!(key in applied)) delete target[key];
    Object.assign(target, applied);
    await live.declaration.onChange?.(target as z.output<z.ZodObject>, this.#ctx!);
  }

  #pending(live: Declared, values: Record<string, unknown>): string[] {
    return [...live.restart].filter((field) => JSON.stringify(live.stored.values[field]) !== JSON.stringify(values[field]));
  }

  #require(namespace: string): Declared {
    const live = this.#live.get(namespace);
    if (!live) throw new Error(`no module declares settings "${namespace}" (known: ${this.namespaces().join(", ") || "none"})`);
    return live;
  }
}
