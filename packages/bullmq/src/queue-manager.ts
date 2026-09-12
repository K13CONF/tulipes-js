import {
  Queue,
  Worker,
  type JobsOptions,
  type Processor,
  type QueueOptions,
  type WorkerOptions,
} from "bullmq";
import { Redis } from "ioredis";

import type { QueuesCapability } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";

/**
 * What `ctx.queues` is once this provider is in the compilation. Core's
 * QueuesCapability is empty; an app that imports anything from this package
 * (its queue files do, for QueueRegistry) sees these members typed.
 */
declare module "@tulipes/core/boot" {
  interface QueuesCapability {
    /** Produce a job. The queue must have been defined by some module. */
    add(queueName: string, jobName: string, data: unknown, options?: JobsOptions): Promise<void>;
    queue(name: string): Queue;
    names(): string[];
    readonly processorCount: number;
    readonly workerCount: number;
  }
}

/**
 * One manager owns every queue in the process. The same `*.queues.ts` files
 * run in BOTH modes — definitions and processors are always registered — and
 * the mode decides what happens with them:
 *
 *   backend    → queues produce; processors are registered but never started
 *   worker → `startWorkers()` turns every registered processor into a
 *            consuming BullMQ Worker
 *
 * That symmetry is what lets a module describe its background work once.
 */
export class QueueManager implements QueuesCapability {
  readonly #url: string;
  readonly #queues = new Map<string, { queue: Queue; owner: string }>();
  readonly #processors = new Map<
    string,
    { handler: Processor; owner: string; options?: Partial<WorkerOptions> }
  >();
  readonly #workers: Worker[] = [];
  readonly #connections: Redis[] = [];
  #closing = false;

  constructor(redisUrl: string) {
    this.#url = redisUrl;
  }

  /**
   * BullMQ re-emits every driver error on its Queue and Worker instances and
   * Node turns an unhandled "error" event into a crash — including the reply
   * that a QUIT cuts short during shutdown. Producers and consumers therefore
   * always carry a listener: during shutdown the error is expected and dropped,
   * otherwise it is surfaced on stderr, since a lost job is a job BullMQ will
   * retry and a dead process would lose the whole queue.
   */
  #observe(name: string, emitter: { on(event: "error", listener: (error: Error) => void): unknown }): void {
    emitter.on("error", (error) => {
      if (this.#closing) return;
      console.error(`[tulipes/bullmq] queue "${name}": ${error.message}`);
    });
  }

  /**
   * Every BullMQ client gets its own connection: workers need dedicated
   * blocking connections anyway, and never sharing keeps close() reasoning
   * trivial. maxRetriesPerRequest: null is a BullMQ requirement.
   */
  #connect(): Redis {
    const connection = new Redis(this.#url, { maxRetriesPerRequest: null });
    this.#connections.push(connection);
    return connection;
  }

  /** @internal Module-scoped facade for the loader. */
  forModule(moduleName: string, report: BootReport): QueueRegistry {
    return new QueueRegistry(this, moduleName, report);
  }

  /** @internal QueueRegistry only. */
  define_(
    name: string,
    owner: string,
    options?: Partial<QueueOptions>,
  ): string | undefined {
    const existing = this.#queues.get(name);
    if (existing) return existing.owner;
    const queue = new Queue(name, { ...options, connection: this.#connect() });
    this.#observe(name, queue);
    this.#queues.set(name, { queue, owner });
    return undefined;
  }

  /** @internal QueueRegistry only. */
  process_(
    name: string,
    handler: Processor,
    owner: string,
    options?: Partial<WorkerOptions>,
  ): string | undefined {
    const existing = this.#processors.get(name);
    if (existing) return existing.owner;
    this.#processors.set(name, { handler, owner, options });
    return undefined;
  }

  /** Introspection for the startup banner and tooling. */
  names(): string[] {
    return [...this.#queues.keys()];
  }

  get processorCount(): number {
    return this.#processors.size;
  }

  get workerCount(): number {
    return this.#workers.length;
  }

  /** Produce a job. The queue must have been defined by some module. */
  async add(
    queueName: string,
    jobName: string,
    data: unknown,
    options?: JobsOptions,
  ): Promise<void> {
    await this.queue(queueName).add(jobName, data, options);
  }

  queue(name: string): Queue {
    const stored = this.#queues.get(name);
    if (!stored) {
      throw new Error(
        `Queue "${name}" was never defined by any module (known: ${[...this.#queues.keys()].join(", ") || "none"})`,
      );
    }
    return stored.queue;
  }

  /** Worker mode only — called by the provider's serve() hook, never by modules. */
  startWorkers(report: BootReport): number {
    for (const [name, { handler, owner, options }] of this.#processors) {
      if (!this.#queues.has(name)) {
        report.add({
          scope: "boot",
          module: owner,
          message: `processor registered for undefined queue "${name}" — call define() first`,
        });
        continue;
      }
      const worker = new Worker(name, handler, { ...options, connection: this.#connect() });
      this.#observe(name, worker);
      this.#workers.push(worker);
    }
    return this.#workers.length;
  }

  /** Stop consumers and finish active jobs while producers remain available. */
  async drain(): Promise<void> {
    // The first shutdown signal this manager receives; errors are expected from here on.
    this.#closing = true;
    const results = await Promise.allSettled(this.#workers.map((worker) => worker.close()));
    throwFailures(results);
  }

  /** Emergency connection teardown after the graceful shutdown deadline. */
  disconnect(): void {
    this.#closing = true;
    for (const worker of this.#workers) void worker.disconnect().catch(() => {});
    for (const connection of this.#connections) connection.disconnect();
  }

  /** Drain order: stop consuming, then producers, then raw connections. */
  async close(): Promise<void> {
    this.#closing = true;
    const results = await Promise.allSettled([this.drain()]);
    // A queue still initializing (its meta write is issued once the client is
    // ready) must finish before its connection is quit, or that reply is lost.
    results.push(...await Promise.allSettled(
      [...this.#queues.values()].map(async ({ queue }) => { await queue.waitUntilReady().catch(() => {}); await queue.close(); }),
    ));
    results.push(...await Promise.allSettled(this.#connections.map(async (connection) => {
      try { await connection.quit(); } finally { connection.disconnect(); }
    })));
    throwFailures(results);
  }
}

// BullMQ reserves ":" (its redis key separator), so module namespacing in
// queue names uses "." instead: "users.welcome".
const QUEUE_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)?$/;

/**
 * Module-scoped facade handed to `*.queues.ts` — mirrors AclBuilder: every
 * registration records its module so conflicts crash with both names.
 */
export class QueueRegistry {
  readonly #manager: QueueManager;
  readonly #module: string;
  readonly #report: BootReport;

  constructor(manager: QueueManager, moduleName: string, report: BootReport) {
    this.#manager = manager;
    this.#module = moduleName;
    this.#report = report;
  }

  define(name: string, options?: Partial<QueueOptions>): this {
    if (!QUEUE_NAME.test(name)) {
      this.#issue(`queue name "${name}" is invalid — lowercase kebab-case, optional "." namespace`);
      return this;
    }
    const owner = this.#manager.define_(name, this.#module, options);
    if (owner) this.#issue(`queue "${name}" is already defined by module "${owner}"`);
    return this;
  }

  process(name: string, handler: Processor, options?: Partial<WorkerOptions>): this {
    const owner = this.#manager.process_(name, handler, this.#module, options);
    if (owner) this.#issue(`queue "${name}" already has a processor from module "${owner}"`);
    return this;
  }

  #issue(message: string): void {
    this.#report.add({ scope: "boot", module: this.#module, message });
  }
}

function throwFailures(results: PromiseSettledResult<unknown>[]): void {
  const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors,
    `Queue cleanup failed — ${errors.map(error => error instanceof Error ? error.message : String(error)).join("; ")}`);
}
