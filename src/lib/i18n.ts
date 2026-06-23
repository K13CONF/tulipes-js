import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import i18next from "i18next"
import FsBackend from "i18next-fs-backend"
import { LanguageDetector, handle } from "i18next-http-middleware"
import type { RequestHandler } from "express"
import config from "@config/app.config.js"
import { logger } from "@config/logger.js"
import type { ModuleConfig } from "@/types/module.js"

/**
 * i18n (internationalization) setup, built on i18next.
 *
 * Each feature module may declare an `i18nFolderPath` (relative to its own
 * folder); that folder becomes an i18next **namespace** named after the module,
 * loading `<lng>.json` files from disk. Languages are detected per-request
 * (header / querystring / cookie) by the exported middleware, exposing `req.t`.
 */

// Settings resolved from the central application config.
const { fallbackLanguage: fallbackLng, supportedLanguages: supportedLngs, defaultNamespace: defaultNS } =
    config.app.lib.i18n

// Modules live at `<dist>/modules/<key>`; this file at `<dist>/lib`.
const modulesRoot = resolve(import.meta.dirname, "../modules")

/**
 * Resolves each module's i18n folder into a namespace map: `{ [moduleKey]: dir }`.
 * Only folders that actually exist on disk are included.
 */
function collectNamespaceDirs(modules: Record<string, ModuleConfig>): Record<string, string> {
    const dirs: Record<string, string> = {}
    for (const [key, module] of Object.entries(modules)) {
        if (!module.i18nFolderPath) continue
        const dir = resolve(modulesRoot, key, module.i18nFolderPath)
        if (existsSync(dir)) {
            dirs[key] = dir
        } else {
            logger.warn(`i18n: module "${key}" declares i18nFolderPath but ${dir} was not found — skipping`)
        }
    }
    return dirs
}

/**
 * Initializes i18next from the modules' locale folders. Call once during
 * bootstrap. Safe to call even when no module ships translations — it falls
 * back to the default namespace.
 */
export async function initI18n(modules: Record<string, ModuleConfig>): Promise<void> {
    const namespaceDirs = collectNamespaceDirs(modules)
    const namespaces = Object.keys(namespaceDirs)
    const ns = namespaces.length > 0 ? namespaces : [defaultNS]

    await i18next
        .use(FsBackend)
        .use(LanguageDetector)
        .init({
            fallbackLng,
            supportedLngs,
            preload: supportedLngs,
            ns,
            defaultNS: namespaceDirs[defaultNS] ? defaultNS : (ns[0] as string),
            // Don't crash a request if a key/namespace is missing.
            partialBundledLanguages: true,
            backend: {
                // Resolve the on-disk file for a given (language, namespace) pair.
                // i18next-fs-backend may pass these as a string or a string[].
                loadPath: (lng: string | string[], ns: string | string[]) => {
                    const language = Array.isArray(lng) ? lng[0] : lng
                    const namespace = Array.isArray(ns) ? ns[0] : ns
                    const dir = namespaceDirs[namespace as string] ?? modulesRoot

                    return join(dir, `${language}.json`)
                },
                // Untranslated keys are written here (requires `saveMissing`).
                addPath: (lng: string | string[], ns: string | string[]) => {
                    const language = Array.isArray(lng) ? lng[0] : lng
                    const namespace = Array.isArray(ns) ? ns[0] : ns
                    const dir = namespaceDirs[namespace as string] ?? modulesRoot

                    return join(dir, `${language}.missing.json`)
                },
            },
            // Only capture missing keys outside production, to avoid disk writes
            // on the hot path in prod.
            saveMissing: config.app.env !== "production",
            detection: {
                order: ["querystring", "header", "cookie"],
                lookupQuerystring: "lng",
                lookupCookie: "lng",
                caches: false,
            },
        })

    // Force-load every (language, namespace) pair from disk so translations are
    // available synchronously after bootstrap (init only schedules the loads).
    await i18next.reloadResources(supportedLngs, ns)

    logger.info(
        `i18n initialized — languages: [${supportedLngs.join(", ")}], namespaces: [${ns.join(", ")}]`,
    )
}

/** Express middleware: detects the request language and attaches `req.t`. */
export const i18nextMiddleware: RequestHandler = handle(i18next) as unknown as RequestHandler

export { i18next }
