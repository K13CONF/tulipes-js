export { QueueManager, QueueRegistry, type JobSchema, type JobSchemas } from "./queue-manager.ts";
export { initQueues, type QueuesFn } from "./load-queues.ts";
export { provider } from "./provider.ts";
export { provider as default } from "./provider.ts";

/**
 * Augmentation target for the generated `types/tulipes.d.ts` (`tulipes sync`):
 * codegen adds one property per queue a `queues/*.queues.ts` file declares
 * in its `jobs` export, typed as that schema's output, so `queues.add` and
 * the processor agree on the job data and a wrong queue name does not
 * compile. Declared in THIS module (not re-exported) because TypeScript
 * module augmentation only merges with the module that declares the interface.
 */
export interface KnownJobs {}

/** Every queue name `tulipes sync` found a job schema for; `never` until it has run. */
export type KnownQueueName = keyof KnownJobs & string;

/**
 * The job data of a queue: the declared shape for a known name, `any` for
 * a name `tulipes sync` has not seen (a dynamic name, or a queue file
 * without a `jobs` export) — one signature, so a wrong payload for a known
 * queue has no untyped overload to fall back to.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobData<N extends string> = N extends KnownQueueName ? KnownJobs[N] : any;

/**
 * What codegen derives from a queue file's `jobs` export: the output type of
 * each schema, keyed by queue name. A file without the export contributes
 * nothing.
 */
export type JobsOf<M> = M extends { jobs: infer J }
  ? { [K in keyof J]: J[K] extends { safeParse(data: unknown): { data?: infer D } } ? Exclude<D, undefined> : unknown }
  : {};
export { readRedisUrl, type BullmqConfig } from "./config.ts";
