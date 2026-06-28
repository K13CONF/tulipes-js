import en from "../i18n/en.json"

type Dict = { [k: string]: string | Dict }

/**
 * Minimal i18next-like `t` for the react-email preview app only: nested-key
 * lookup against `en.json` plus `{{var}}` interpolation. The real app injects
 * i18next's `t` via `lib/email-renderer.ts`; this just renders realistic copy in
 * the browser preview without booting i18next.
 */
export function previewT(key: string, vars: Record<string, unknown> = {}): string {
    const value = key.split(".").reduce<unknown>(
        (acc, part) => (acc && typeof acc === "object" ? (acc as Dict)[part] : undefined),
        en as Dict,
    )
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ""))
}
