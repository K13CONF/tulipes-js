import type { ModuleConfig } from "@/types/module.js"
import { logger } from "@config/logger.js"

/** Order by priority, higher first (default 0). */
function byPriorityDesc(a: ModuleConfig, b: ModuleConfig): number {
    return (b.priority ?? 0) - (a.priority ?? 0)
}

/**
 * Orders modules so each module's `depends` are initialized before it, using
 * `priority` (higher first) to break ties among independent modules. Throws on
 * unknown dependencies or dependency cycles.
 */
export function resolveInitOrder(modules: Record<string, ModuleConfig>): ModuleConfig[] {
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
export async function initModules(modules: Record<string, ModuleConfig>): Promise<void> {
    for (const module of resolveInitOrder(modules)) {
        if (module.onInit) {
            await module.onInit()
            logger.info(`✅ Module "${module.name}" initialized`)
        }
    }
}
