import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { glob } from "glob"
import type { ModuleConfig } from "@/types/module.js"
import { logger } from "@config/logger.js"

// Modules live at `<dist>/modules/<key>`; this file at `<dist>/lib`.
const modulesRoot = resolve(import.meta.dirname, "../modules")

/**
 * Eagerly imports every `*.model.js` under each module's declared
 * `modelsFolderPath` so the side-effect `mongoose.model(...)` calls register the
 * schemas with Mongoose before the app serves traffic. Call once during
 * bootstrap, after the global base plugin is registered (see `register.ts`).
 * Re-importing a model is a no-op, so this is safe to call repeatedly.
 *
 * `modules` is keyed by folder name (the on-disk module directory) so each
 * relative `modelsFolderPath` can be resolved against `<modulesRoot>/<key>`.
 */
export async function loadModuleModels(modules: Record<string, ModuleConfig>): Promise<void> {
    let count = 0

    for (const [key, module] of Object.entries(modules)) {
        if (!module.modelsFolderPath) continue

        // Compiled models are `*.model.js`; sources are `*.model.ts`. Sorted for
        // a deterministic, log-friendly load order. Missing folders glob to [].
        const dir = resolve(modulesRoot, key, module.modelsFolderPath)
        const files = (await glob("**/*.model.js", { cwd: dir, absolute: true })).sort()

        for (const file of files) {
            await import(pathToFileURL(file).href)
        }
        count += files.length
    }

    logger.info(`Loaded ${count} module model(s)`)
}

/** Order by priority, higher first (default 0). */
function byPriorityDesc(a: ModuleConfig, b: ModuleConfig): number {
    return (b.priority ?? 0) - (a.priority ?? 0)
}

/**
 * Orders modules so each module's `depends` are initialized before it, using
 * `priority` (higher first) to break ties among independent modules. Throws on
 * unknown dependencies or dependency cycles.
 */
export function sortModulesByPriorityAndDependencies(modules: Record<string, ModuleConfig>): ModuleConfig[] {
    const all = Object.values(modules)
    const byName = new Map(all.map((module) => [module.name, module]))

    const placed = new Set<string>()
    const onStack = new Set<string>()
    const ordered: ModuleConfig[] = []

    function visit(module: ModuleConfig): void {
        if (placed.has(module.name)) return
        if (onStack.has(module.name)) {
            throw new Error(`Circular module dependency detected involving "${module.name}"`)
        }
        onStack.add(module.name)

        const dependencies = (module.depends ?? [])
            .map((name) => {
                const dependency = byName.get(name)
                if (!dependency) {
                    throw new Error(`Module "${module.name}" depends on unknown module "${name}"`)
                }
                return dependency
            })
            .sort(byPriorityDesc)

        for (const dependency of dependencies) {
            visit(dependency)
        }

        onStack.delete(module.name)
        placed.add(module.name)
        ordered.push(module)
    }

    for (const module of [...all].sort(byPriorityDesc)) {
        visit(module)
    }

    return ordered
}

/**
 * Runs every module's `onInit` hook in dependency + priority order. Call once
 * during bootstrap, after the database connection is established.
 */
export async function initModules(modules: ModuleConfig[]): Promise<void> {

    // Resolve each module
    for (const module of modules) {

        // Initialise the module
        if (module.onInit) {
            try {
                await module.onInit()
                logger.info(`Module "${module.name}" initialized`)
            } catch (e: any) {
                logger.warn(`Failed calling module ${module.name}.onInit() rejected with error: ${e.message}`)
            }
        }
    }
}

