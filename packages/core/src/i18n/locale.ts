import type { Request } from "express";

/**
 * Locale negotiation, in the order a request means them:
 *
 *   1. `?lang=fr`      — an explicit override; survives a shared link and
 *                        makes a locale testable with curl
 *   2. Accept-Language — what the browser actually asked for, q-values
 *                        honoured
 *   3. the default     — config.i18n.defaultLocale
 *
 * Every candidate is narrowed to the locales the app ships: an unsupported
 * `?lang=xx` falls through to the header rather than serving keys.
 */

/** The query parameter that overrides the header. */
export const LOCALE_QUERY = "lang";

export function resolveLocale(
  req: Request,
  supported: readonly string[],
  fallback: string,
): string {
  const asked = req.query?.[LOCALE_QUERY];
  const override = match(typeof asked === "string" ? asked : undefined, supported);
  if (override) return override;

  for (const tag of parseAcceptLanguage(req.header("accept-language"))) {
    const hit = match(tag, supported);
    if (hit) return hit;
  }

  return fallback;
}

/**
 * `fr-FR` is served by `fr`: a region the app does not ship is a narrower
 * request than it can answer, not an unanswerable one. Exact matches win,
 * so shipping both `fr` and `fr-CA` still resolves `fr-CA` precisely.
 */
function match(tag: string | undefined, supported: readonly string[]): string | undefined {
  if (!tag) return undefined;
  const wanted = tag.trim().toLowerCase();
  if (!wanted) return undefined;

  const exact = supported.find((locale) => locale.toLowerCase() === wanted);
  if (exact) return exact;

  const base = wanted.split("-")[0]!;
  return supported.find((locale) => locale.toLowerCase().split("-")[0] === base);
}

/** Tags of an Accept-Language header, most-preferred first. */
function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];

  return header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q=([\d.]+)\s*$/.exec(param))
        .find(Boolean)?.[1];
      // A malformed q is treated as 1: the client still named the language,
      // and dropping it entirely would be a harsher reading than intended.
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}
