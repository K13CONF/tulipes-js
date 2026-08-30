import type { CorsOptions } from "cors";
import type { HelmetOptions } from "helmet";
import type { Environment } from "@tulipes/core/env";

/**
 * Helmet tuned for an API rather than a web page. Defaults assume a site
 * that serves HTML and its own assets; this one serves JSON and nothing
 * else, so the policy can be far stricter.
 */
export function helmetOptions(environment: Environment): HelmetOptions {
  const maxAge = Number(environment.get("HSTS_MAX_AGE"));

  return {
    // An API serves no active content: deny every resource type outright,
    // which defuses any HTML-ish response a bug might produce.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
    },
    // Browsers only honour HSTS over HTTPS, so it is inert in local dev —
    // but a max-age of 0 lets a deployment switch it off deliberately.
    hsts: maxAge > 0 ? { maxAge, includeSubDomains: true } : false,
    // Helmet defaults to SAMEORIGIN; an API is never framed at all.
    frameguard: { action: "deny" },
    // Irrelevant without a browsing context, and it costs a header.
    originAgentCluster: false,
    crossOriginEmbedderPolicy: false,
  };
}

/**
 * CORS from the environment, because allowed origins differ per
 * deployment. Fail-closed: the default is an empty list, meaning no
 * cross-origin browser may call this API until one is named.
 */
export function corsOptions(environment: Environment): CorsOptions {
  const raw = String(environment.get("CORS_ORIGINS")).trim();
  const credentials = Boolean(environment.get("CORS_CREDENTIALS"));

  if (raw === "*") {
    // "*" and credentials are mutually exclusive per the CORS spec — the
    // browser rejects the response, so refuse the combination at boot
    // rather than shipping an API that silently fails in production.
    if (credentials) {
      throw new Error(
        'CORS_ORIGINS="*" cannot be combined with CORS_CREDENTIALS=true — list the origins explicitly',
      );
    }
    return { origin: true, credentials: false };
  }

  const origins = raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  return { origin: origins, credentials };
}
