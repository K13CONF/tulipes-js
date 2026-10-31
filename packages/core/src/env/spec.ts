import { z } from "zod/v4";

/**
 * The shape of a module's environment contract — the `tulipes.env` key of
 * its package.json. It is plain JSON on purpose: tooling (`tulipes sync`,
 * `.env.example`, the console) must read a module's contract without
 * executing its code.
 *
 * An entry is keyed by the **config name** the value is read under, and
 * says which **variable** supplies it:
 *
 *   "env": {
 *     "port":     { "key": "PORT",      "type": "number", "default": 3000, "description": "HTTP port" },
 *     "mongoUri": { "key": "MONGO_URI", "type": "url",    "description": "MongoDB connection string" }
 *   }
 *
 * The module `core` declaring `port` reads it as `ctx.config.core.port`,
 * beside its settings; the deployment still sets `PORT`.
 */

export const variableTypes = [
  "string",
  "number",
  "boolean",
  "enum",
  "url",
  /** A string that is never printed, described or serialised. */
  "secret",
] as const;

export type VariableType = (typeof variableTypes)[number];

/** What a variable resolves to after coercion. */
export type VariableValue = string | number | boolean;

/**
 * A config name is camelCase, like a settings field, because the two share
 * a module's namespace (`ctx.config.<module>`) and so should share a style.
 */
const CONFIG_KEY = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Names that would change how the namespace object behaves rather than add
 * a value to it: `then` makes it thenable, `toJSON` hijacks serialisation,
 * the others shadow Object.prototype.
 */
const RESERVED_CONFIG_KEYS = new Set(["then", "toJSON", "constructor", "prototype", "valueOf", "toString"]);

/** The variable's name in the env file and the container: UPPER_SNAKE_CASE. */
const VARIABLE_KEY = /^[A-Z][A-Z0-9_]*$/;

export const configKeySchema = z
  .string()
  .regex(CONFIG_KEY, "must be camelCase (e.g. mongoUri)")
  .refine((key) => !RESERVED_CONFIG_KEYS.has(key), { message: "is reserved" });

export const variableSpecSchema = z
  .object({
    key: z.string().regex(VARIABLE_KEY, "must be UPPER_SNAKE_CASE (e.g. USERS_MAX_SESSIONS)"),
    type: z.enum(variableTypes),
    description: z.string().min(1),
    /**
     * Free-form label tying related variables together (every Mongo part
     * under "database"); drives the sections of the generated `.env.example`.
     */
    group: z.string().min(1).optional(),
    enum: z.array(z.string()).nonempty().optional(),
    /** The deployment must supply it; absence aborts the boot. */
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .superRefine((spec, ctx) => {
    // Pairings the object shape cannot express.
    if (spec.type === "enum" && !spec.enum) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${spec.key}": type "enum" requires an "enum" value list` });
    }
    if (spec.type !== "enum" && spec.enum) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${spec.key}": "enum" list is only valid with type "enum"` });
    }
    // `required` means "the deployment must supply it" — a default would
    // silently defeat that, so the combination is refused.
    if (spec.required && spec.default !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${spec.key}": "required" and "default" are mutually exclusive` });
    }
  });

export type VariableSpec = z.infer<typeof variableSpecSchema>;

/** Config name → the variable that supplies it. */
export type EnvDeclaration = Record<string, VariableSpec>;

/** The 0.11 shape was an array of `{ name, … }`; it is refused by name, with the way out. */
export const LEGACY_ARRAY_MESSAGE =
  'tulipes.env is an object keyed by config name since 0.12 ({ "port": { "key": "PORT", … } }) — `tulipes migrate 0.12` rewrites a 0.11 module';

export const envDeclarationSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    // Fatal: the one line that names the way out is the whole report; the
    // record schema below would add a meaningless line per array entry.
    if (Array.isArray(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: LEGACY_ARRAY_MESSAGE, fatal: true });
  })
  .pipe(z.record(configKeySchema, variableSpecSchema))
  .superRefine((declaration, ctx) => {
    // Two config names fed by one variable would be the same value under two
    // names; one is a typo or a leftover.
    const seen = new Map<string, string>();
    for (const [configKey, spec] of Object.entries(declaration)) {
      const other = seen.get(spec.key);
      if (other) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [configKey], message: `variable "${spec.key}" already supplies "${other}"` });
      seen.set(spec.key, configKey);
    }
  });
