import type { EnvValues } from "../config/index.ts";
import type { VariableSpec, VariableValue } from "./spec.ts";

/** Which source supplied a value, in precedence order. */
export type VariableSource = "process.env" | "file" | "default";

/** One declared variable after resolution: its owner, its config name, and what it resolved to. */
export interface ResolvedVariable {
  module: string;
  configKey: string;
  spec: VariableSpec;
  /** Undefined when no source supplied it (optional and absent, or lenient and invalid). */
  value: VariableValue | undefined;
  source: VariableSource | undefined;
}

/**
 * What a console or `tulipes env:check` may say about one variable. A
 * secret's value is never here: `value` is undefined for it, and nothing
 * but the module that declared it can read the real one, through
 * `ctx.config`.
 */
export interface EnvVariableDescription {
  /** The config name: `ctx.config.<module>.<name>`. */
  name: string;
  /** The variable in the env file and the container. */
  key: string;
  type: VariableSpec["type"];
  description: string;
  group: string | undefined;
  required: boolean;
  enum: readonly string[] | undefined;
  /** Undefined for a secret, whatever it declares. */
  default: VariableValue | undefined;
  source: VariableSource | undefined;
  isSet: boolean;
  isSecret: boolean;
  value: VariableValue | undefined;
}

/** The read side of resolved variables, for the console. */
export interface EnvInspector {
  /** Every variable `module` declares, in declaration order; empty for a module that declares none. */
  describe(module: string): EnvVariableDescription[];
}

/**
 * The outcome of phase 1, held by boot: the values as the app config and
 * the binder consume them, and the metadata the console reports. It knows
 * nothing about `ctx.config`; the binder does that.
 */
export class ResolvedEnv implements EnvInspector {
  readonly #entries: readonly ResolvedVariable[];
  readonly #values: EnvValues;

  constructor(entries: readonly ResolvedVariable[]) {
    this.#entries = entries;
    this.#values = ResolvedEnv.#group(entries);
  }

  /**
   * `{ [module]: { [configKey]: value } }`, frozen: what `config/app.config.ts`
   * receives, so it can wire `server.port` from `env.core.port` without
   * being able to change what a module will read.
   */
  get values(): EnvValues {
    return this.#values;
  }

  get entries(): readonly ResolvedVariable[] {
    return this.#entries;
  }

  describe(module: string): EnvVariableDescription[] {
    return this.#entries
      .filter((entry) => entry.module === module)
      .map((entry) => ResolvedEnv.#describe(entry));
  }

  /**
   * One line per variable for `tulipes env:check`, secrets redacted. A
   * redaction is a string the operator recognises, never the empty string
   * a missing value would show.
   */
  snapshot(): { module: string; name: string; key: string; value: VariableValue | undefined; redacted: boolean }[] {
    return this.#entries.map((entry) => {
      const secret = entry.spec.type === "secret";
      const value = secret && entry.value !== undefined ? "•••" : ResolvedEnv.#shown(entry, entry.value);
      return {
        module: entry.module,
        name: entry.configKey,
        key: entry.spec.key,
        value,
        redacted: value !== entry.value,
      };
    });
  }

  static #describe(entry: ResolvedVariable): EnvVariableDescription {
    const isSecret = entry.spec.type === "secret";
    return {
      name: entry.configKey,
      key: entry.spec.key,
      type: entry.spec.type,
      description: entry.spec.description,
      group: entry.spec.group,
      required: entry.spec.required ?? false,
      enum: entry.spec.enum,
      default: isSecret ? undefined : ResolvedEnv.#shown(entry, entry.spec.default),
      source: entry.source,
      isSet: entry.value !== undefined,
      isSecret,
      value: isSecret ? undefined : ResolvedEnv.#shown(entry, entry.value),
    };
  }

  /**
   * A `url` is not a secret, but a connection string often carries one:
   * `mongodb://user:password@host/db`, `redis://:password@host`, or
   * `?password=` in the query. Those parts are masked wherever a value is
   * shown; scheme, hosts and path stay readable.
   */
  static #shown(entry: ResolvedVariable, value: VariableValue | undefined): VariableValue | undefined {
    return entry.spec.type === "url" && typeof value === "string" ? withoutCredentials(value) : value;
  }

  static #group(entries: readonly ResolvedVariable[]): EnvValues {
    const grouped: Record<string, Record<string, VariableValue | undefined>> = {};
    for (const entry of entries) (grouped[entry.module] ??= {})[entry.configKey] = entry.value;
    for (const module of Object.values(grouped)) Object.freeze(module);
    // `tulipes sync` augments EnvValues with one required block per module
    // that declares anything, from the same manifests these entries came
    // from — so the promise holds at runtime, the way `ctx.config` is typed
    // by codegen and built as `{}`.
    return Object.freeze(grouped) as EnvValues;
  }
}

/** `scheme://user:pass@hosts/path?password=x` → `scheme://•••@hosts/path?password=•••`. */
export function withoutCredentials(url: string): string {
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1•••@")
    .replace(/([?&](?:password|pass|pwd|secret|token|access_?key|api_?key)=)[^&#]*/gi, "$1•••");
}
