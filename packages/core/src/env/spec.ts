import { z } from "zod";

/**
 * Schema for one entry in a module's `meta.variables.json`.
 *
 * The file is deliberately plain JSON (not TS): tooling — `.env.example`
 * generation, docs, the postman generator — must be able to read a module's
 * env contract without executing its code.
 */

export const variableTypes = [
  "string",
  "number",
  "boolean",
  "enum",
  "url",
  /** Same as string, but redacted in logs, reports and snapshots. */
  "secret",
] as const;

export type VariableType = (typeof variableTypes)[number];

/** Values a variable can resolve to after coercion. */
export type VariableValue = string | number | boolean;

const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;

export const variableSpecSchema = z
  .object({
    name: z
      .string()
      .regex(VARIABLE_NAME, "must be UPPER_SNAKE_CASE (e.g. USERS_MAX_SESSIONS)"),
    type: z.enum(variableTypes),
    description: z.string().min(1),
    /**
     * Free-form label tying related variables together (e.g. every Mongo
     * credential under "database") — drives section grouping in generated
     * .env.example / docs. Purely organizational, hence optional.
     */
    group: z.string().min(1).optional(),
    enum: z.array(z.string()).nonempty().optional(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .superRefine((spec, ctx) => {
    // These pairings can't be expressed structurally, so they live here:
    if (spec.type === "enum" && !spec.enum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${spec.name}": type "enum" requires an "enum" value list`,
      });
    }
    if (spec.type !== "enum" && spec.enum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${spec.name}": "enum" list is only valid with type "enum"`,
      });
    }
    // required means "the deployment must supply it" — a default would
    // silently defeat that, so the combination is rejected outright.
    if (spec.required && spec.default !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${spec.name}": "required" and "default" are mutually exclusive`,
      });
    }
  });

export type VariableSpec = z.infer<typeof variableSpecSchema>;

export const metaFileSchema = z.object({
  $schema: z.string().optional(),
  variables: z.array(variableSpecSchema),
});

export type MetaFile = z.infer<typeof metaFileSchema>;
