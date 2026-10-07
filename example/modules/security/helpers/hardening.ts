import type { CorsOptions } from "cors";
import type { HelmetOptions } from "helmet";

/** The settings the hardening middleware is built from — `ctx.config.security`. */
export interface HardeningSettings {
  hstsMaxAge: number;
  corsOrigins: string;
  corsCredentials: boolean;
}

/**
 * Helmet tuned for an API rather than a web page. Defaults assume a site
 * that serves HTML and its own assets; this one serves JSON and nothing
 * else, so the policy can be far stricter.
 */
export function helmetOptions(settings: Pick<HardeningSettings, "hstsMaxAge">): HelmetOptions {
  const maxAge = settings.hstsMaxAge;

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
 * CORS controls which browser origins can read responses. An empty list
 * grants no cross-origin access; it does not reject incoming HTTP requests.
 * Authentication and any future cookie/CSRF checks remain separate controls.
 */
export function corsOptions(settings: Pick<HardeningSettings, "corsOrigins" | "corsCredentials">): CorsOptions {
  const raw = settings.corsOrigins.trim();
  // This controls Access-Control-Allow-Credentials, not token extraction.
  // Explicit Bearer headers do not require cookie authentication to be enabled.
  const credentials = settings.corsCredentials;

  if (raw === "*") {
    // "*" and credentials are mutually exclusive per the CORS spec — the
    // browser rejects the response, so the schema refuses the combination
    // rather than storing a policy that silently fails in production.
    if (credentials) {
      throw new Error('corsOrigins "*" cannot be combined with corsCredentials — list the origins explicitly');
    }

    return { origin: true, credentials: false };
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return { origin: origins, credentials };
}
