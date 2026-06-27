import { Queue, Worker, type Job, type Processor, type ConnectionOptions } from "bullmq"
import { type RedisConfig } from "./redis.js"
import { logger } from "@config/logger.js"

/**
 * One shared queue for the whole app (even in cluster mode). Features add work
 * by name via `getQueue().add(name, data)` and register a handler with
 * `registerJobHandler(name, fn)`; the single worker dispatches by job name.
 *
 * In cluster mode every worker process runs its own `Worker` against this one
 * queue — that's standard BullMQ horizontal scaling, no per-process queues.
 */
export const QUEUE_NAME = "app"

let queue: Queue | null = null
let worker: Worker | null = null

/** Job name → handler. Populated by features (e.g. the mailer) before the worker starts. */
const handlers = new Map<string, (job: Job) => Promise<unknown>>()

/** Registers the handler for a job name. Call during boot, before `startWorker`. */
export function registerJobHandler(name: string, handler: (job: Job) => Promise<unknown>): void {
    handlers.set(name, handler)
}

/** Dispatches a job to its registered handler. */
const dispatch: Processor = async (job) => {
    const handler = handlers.get(job.name)
    if (!handler) throw new Error(`No handler registered for job "${job.name}"`)
    return handler(job)
}

/**
 * BullMQ connection options. Passing options (not a shared client) lets BullMQ
 * create its own dedicated connection per Queue/Worker — the recommended setup
 * (workers hold a blocking connection). `maxRetriesPerRequest: null` is required.
 */
function connectionFor(cfg: RedisConfig): ConnectionOptions {
    return {
        host: cfg.host,
        port: cfg.port,
        db: cfg.db,
        maxRetriesPerRequest: null,
        ...(cfg.password ? { password: cfg.password } : {}),
    }
}

/** Creates the shared queue (producer side). Idempotent. */
export function setupQueue(cfg: RedisConfig): Queue {
    if (queue) return queue

    queue = new Queue(QUEUE_NAME, {
        connection: connectionFor(cfg),
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 24 * 3600 },
        },
    })
    queue.on("error", (err) => logger.error({ err }, "Queue error"))
    return queue
}

/** Starts the single worker consuming the shared queue. Idempotent. */
export function startWorker(cfg: RedisConfig, concurrency?: number): Worker {
    if (worker) return worker

    worker = new Worker(QUEUE_NAME, dispatch, {
        connection: connectionFor(cfg),
        ...(concurrency && concurrency > 0 ? { concurrency } : {}),
    })
    worker.on("failed", (job, err) =>
        logger.error({ err, jobId: job?.id, name: job?.name }, "Job failed"),
    )
    worker.on("completed", (job) =>
        logger.debug({ jobId: job.id, name: job.name }, "Job completed"),
    )
    logger.info(`Queue worker started — consuming "${QUEUE_NAME}"`)
    return worker
}

/** The shared queue. Throws if accessed before `setupQueue`. */
export function getQueue(): Queue {
    if (!queue) throw new Error("Queue not initialized — call setupQueue() during boot first")
    return queue
}

/** Closes the worker then the queue (and their Redis connections). */
export async function closeQueue(): Promise<void> {
    await worker?.close()
    await queue?.close()
    worker = null
    queue = null
}
