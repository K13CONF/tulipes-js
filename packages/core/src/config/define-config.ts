import { z } from "zod/v4";

import type { Ctx } from "../boot/contracts.ts";

/**
 * The one export of `module.config.ts`: what this module's settings look
 * like. Values live in the settings store (phase 6), not in this file —
 * the declaration gives their shape, their defaults, their documentation
 * for the console and the agent manifest, and the hook that runs when an
 * operator changes them.
 *
 *   export default defineConfig({
 *     schema: z.object({
 *       maxSessions: z.number().int().positive().default(5)
 *         .describe("Max concurrent sessions per user"),
 *     }),
 *     onChange(next, ctx) {},
 *   });
 *
 * Every field needs a default, because an operator is never asked for a
 * value the process needs to boot. A field that cannot be hot-applied is
 * tagged `.meta({ restart: true })`: a write to it persists, applies on the
 * next boot, and the write reports `requires_restart`. Secrets are refused:
 * they belong to the environment, never to a store a console can read.
 */
export interface ConfigDeclaration<Schema extends ConfigSchema = ConfigSchema> {
  readonly [CONFIG_DECLARATION]: true;
  readonly schema: Schema;
  /** After a write lands, in every process that holds the app. */
  readonly onChange?: (next: ConfigOutput<Schema>, ctx: Ctx) => void | Promise<void>;
}

export interface ConfigDeclarationInput<Schema extends ConfigSchema> {
  schema: Schema;
  onChange?: (next: ConfigOutput<Schema>, ctx: Ctx) => void | Promise<void>;
}

/**
 * What a settings schema must look like, structurally: a zod object from any
 * zod 4 copy — core's own `zod/v4` (zod 3.25) or a module's zod 4.x. Typing
 * it nominally as `z.ZodObject` made TypeScript compare two copies' internals
 * recursively and give up (TS2589), though the runtime accepts both: zod 4
 * identifies its instances by trait, not by prototype. Route schemas are
 * structural for the same reason (`ValidatableSchema`).
 */
export interface ConfigSchema {
  readonly shape: object;
  safeParse(input: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  readonly _zod: { readonly output: unknown };
}

/** A schema's parsed value, read through zod 4's `_zod` marker both copies expose. */
export type ConfigOutput<Schema extends ConfigSchema> = Schema["_zod"]["output"];

/** Symbol.for so a declaration survives duplicate copies of core. */
export const CONFIG_DECLARATION = Symbol.for("tulipes.config-declaration");

export function defineConfig<Schema extends ConfigSchema>(input: ConfigDeclarationInput<Schema>): ConfigDeclaration<Schema> {
  return Object.freeze({ [CONFIG_DECLARATION]: true as const, schema: input.schema, ...(input.onChange && { onChange: input.onChange }) });
}

export function isConfigDeclaration(value: unknown): value is ConfigDeclaration {
  return typeof value === "object" && value !== null && (value as { [CONFIG_DECLARATION]?: unknown })[CONFIG_DECLARATION] === true;
}

/** Metadata a field may carry through `.meta()`, read through every wrapper (default, optional, …). */
export interface FieldMeta {
  restart?: boolean;
  secret?: boolean;
  [key: string]: unknown;
}

export function fieldMeta(schema: z.ZodType): FieldMeta {
  let current: z.ZodType | undefined = schema;
  const merged: FieldMeta = {};
  while (current) {
    const meta = current.meta?.() as FieldMeta | undefined;
    if (meta) for (const [key, value] of Object.entries(meta)) if (!(key in merged)) merged[key] = value;
    current = (current as { _zod?: { def?: { innerType?: z.ZodType } } })._zod?.def?.innerType;
  }
  return merged;
}

/**
 * What is wrong with a declaration, if anything. Checked once at boot (phase
 * 4) so a module cannot ship a schema the store could never satisfy.
 */
export function declarationProblems(declaration: ConfigDeclaration): string[] {
  const problems: string[] = [];
  const schema = declaration.schema as unknown as z.ZodObject;
  if (!(schema instanceof z.ZodObject)) {
    problems.push("schema must be a zod object (z.object({ ... }))");
    return problems;
  }
  for (const [name, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    if (fieldMeta(field).secret) problems.push(`field "${name}" is marked secret — secrets are environment variables, never settings`);
    if (!field.safeParse(undefined).success) problems.push(`field "${name}" has no default — every setting needs one`);
  }
  return problems;
}

/** The fields that only apply on the next boot. */
export function restartFields(declaration: ConfigDeclaration): string[] {
  return Object.entries((declaration.schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>)
    .filter(([, field]) => fieldMeta(field).restart === true)
    .map(([name]) => name);
}

/** JSON Schema of the declaration, for the console and the agent manifest. */
export function declarationJsonSchema(declaration: ConfigDeclaration): Record<string, unknown> {
  const json = z.toJSONSchema(declaration.schema as unknown as z.ZodObject, { unrepresentable: "any", io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
