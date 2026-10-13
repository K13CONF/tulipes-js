import type { HydratedDocument, InferSchemaType, Model, ObtainSchemaGeneric, Schema } from "mongoose";

export { initDatabase, type BootstrapFn, type ModelDef } from "./database.ts";
export { readConnectionConfig, type MongooseConnectionConfig } from "./connection-config.ts";
export { ModelStore } from "./model-store.ts";
export { MongoSettingsStore, type MongoSettingsStoreOptions, type SettingsDocument, type SettingsHistoryDocument } from "./settings-store.ts";
export { provider as settingsProvider } from "./settings-provider.ts";
export { provider } from "./provider.ts";
export { provider as default } from "./provider.ts";

/**
 * Augmentation target for the generated `types/tulipes.d.ts` (`tulipes sync`):
 * codegen adds one property per `models/*.model.ts`, keyed by the model's
 * name and typed as the file's default export, so `ctx.models.get("User")`
 * is typed from the schema the model file declares and a wrong name does
 * not compile. Declared in THIS module (not re-exported) because TypeScript
 * module augmentation only merges with the module that declares the interface.
 */
export interface KnownModels {}

/** Every model name `tulipes sync` found; `never` until it has run. */
export type KnownModelName = keyof KnownModels & string;

/**
 * The model mongoose compiles from a schema — the same type `model(name,
 * schema)` returns, with the schema's methods, statics, virtuals and query
 * helpers carried over.
 */
export type ModelOf<TSchema extends Schema> = Model<
  InferSchemaType<TSchema>,
  ObtainSchemaGeneric<TSchema, "TQueryHelpers">,
  ObtainSchemaGeneric<TSchema, "TInstanceMethods">,
  ObtainSchemaGeneric<TSchema, "TVirtuals">,
  HydratedDocument<
    InferSchemaType<TSchema>,
    ObtainSchemaGeneric<TSchema, "TVirtuals"> & ObtainSchemaGeneric<TSchema, "TInstanceMethods">,
    ObtainSchemaGeneric<TSchema, "TQueryHelpers">,
    ObtainSchemaGeneric<TSchema, "TVirtuals">,
    ObtainSchemaGeneric<TSchema, "TSchemaOptions">
  >,
  TSchema
> & ObtainSchemaGeneric<TSchema, "TStaticMethods">;

/** The model a `models/*.model.ts` default export compiles to. */
export type DefinedModel<Def> = Def extends { schema: infer S extends Schema } ? ModelOf<S> : Model<unknown>;

/** What `ctx.models.get(name)` returns for a known name. */
export type KnownModel<N extends KnownModelName> = DefinedModel<KnownModels[N]>;
