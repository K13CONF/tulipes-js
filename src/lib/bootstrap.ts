import config, { moduleRegistry } from "@config/app.config.js"
import { connect } from "./mongoose.js"
import { connectRedis } from "./redis.js"
import { initCache } from "./cache.js"
import { setupQueue } from "./queue.js"
import { initMailer } from "./mailer.js"
import { loadModuleModels } from "./modules.js"

/**
 * Connects the infrastructure shared by the web and worker processes: module
 * models, MongoDB, Redis, the cache, the queue (producer side), and the mailer.
 *
 * Ordered deliberately: models register (the global base plugin is already
 * applied via `register.ts`), then connections open, then the queue exists
 * before the mailer registers its job handler. Call once per process during
 * boot, after importing `@packages/mongoose/register.js`.
 */
export async function bootstrapInfra(): Promise<void> {
    await loadModuleModels(moduleRegistry)
    await connect(config.app.lib.database)
    await connectRedis(config.app.lib.redis)
    initCache()
    setupQueue(config.app.lib.redis)
    initMailer(config.app.lib.mailer)
}
