/**
 * Environment values — internal to boot and to the CLI's `sync` and
 * `env:check`. An app never imports from here: it reads a value as
 * `ctx.config.<module>.<name>` and sees the shape of a declaration in its
 * module's package.json.
 *
 *   spec      what a declaration looks like
 *   coerce    a raw string → the declared type
 *   resolve   declarations + process.env + the env file → ResolvedEnv
 *   resolved  the values, and what the console may say about them
 *   bind      ResolvedEnv → read-only getters on ctx.config
 */
export { bindEnvValues } from "./bind.ts";
export { coerceValue } from "./coerce.ts";
export { resolveEnv, type ResolveEnvOptions } from "./resolve.ts";
export { ResolvedEnv, type EnvInspector, type EnvVariableDescription, type ResolvedVariable, type VariableSource } from "./resolved.ts";
export {
  LEGACY_ARRAY_MESSAGE,
  configKeySchema,
  envDeclarationSchema,
  variableSpecSchema,
  variableTypes,
  type EnvDeclaration,
  type VariableSpec,
  type VariableType,
  type VariableValue,
} from "./spec.ts";
