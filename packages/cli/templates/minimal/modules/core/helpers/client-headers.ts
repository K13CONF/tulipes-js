import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { HttpError } from "@tulipes/core/http";

/**
 * The headers every client (web, Android, iOS) sends on every request, read
 * once by the core module so handlers and log lines know who called and
 * which exact request it was. Language and time zone are not here: core
 * already reads `Accept-Language` into `req.locale` and `X-Timezone` into
 * `req.timezone` for every declared route.
 *
 * A header is described by data, so adding one is a row here and a case in
 * the test. Missing or invalid values fall back to `default`; only a header
 * marked `required: true` can fail a request, with a 400 naming every
 * missing one. No header is required today.
 */
const ID = /^[0-9A-Za-z._-]{8,128}$/;
const VERSION = /^\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)*$/;

export interface HeaderSpec {
  header: string;
  /** Accepted values, compared after lower-casing. */
  values?: readonly string[];
  /** The value must match, as sent. */
  pattern?: RegExp;
  required?: boolean;
  default: string | null;
}

export const CLIENT_HEADERS = {
  platform:   { header: "x-platform",    values: ["web", "android", "ios"], default: "web" },
  appVersion: { header: "x-app-version", pattern: VERSION, default: null },
  appMode:    { header: "x-app-mode",    values: ["development", "staging", "production"], default: "production" },
  deviceId:   { header: "x-device-id",   pattern: ID, default: null },
  /** `null` means a uuid is generated; a valid client id is kept and echoed. */
  requestId:  { header: "x-request-id",  pattern: ID, default: null },
} satisfies Record<string, HeaderSpec>;

export interface ClientHeaders {
  platform: string;
  appVersion: string | null;
  appMode: string;
  deviceId: string | null;
  requestId: string;
}

declare global {
  namespace Express {
    interface Request {
      /** What the client said about itself; set by the core module before every route. */
      client: ClientHeaders;
    }
  }
}

/**
 * Pure: reads through `get` (header names are case-insensitive) so it can be
 * tested without a request. `missing` lists required headers that were absent.
 */
export function readClientHeaders(
  get: (name: string) => string | undefined,
  specs: Record<keyof ClientHeaders, HeaderSpec> = CLIENT_HEADERS,
): { client: ClientHeaders; missing: string[] } {
  const missing: string[] = [];
  const client = {} as Record<string, string | null>;
  for (const [key, spec] of Object.entries(specs)) {
    const raw = get(spec.header)?.trim() || null;
    if (raw === null && spec.required) missing.push(spec.header);
    const value = raw !== null && spec.values ? raw.toLowerCase() : raw;
    const valid = value !== null
      && (!spec.values || spec.values.includes(value))
      && (!spec.pattern || spec.pattern.test(value));
    client[key] = valid ? value : spec.default;
  }
  client.requestId ??= randomUUID();
  return { client: client as unknown as ClientHeaders, missing };
}

/**
 * Binds `req.client` and echoes `X-Request-Id`, so client and server log
 * the same id. Mounted by the core module, which loads before cors: a
 * preflight is answered by cors and must never meet a required-header
 * check, so OPTIONS is skipped.
 */
export function clientHeaders(): RequestHandler {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    const { client, missing } = readClientHeaders((name) => req.get(name));
    if (missing.length) {
      return next(new HttpError(400, "clientHeadersRequired", {
        code: "CLIENT_HEADERS_REQUIRED",
        defaultMessage: `Missing required headers: ${missing.join(", ")}`,
      }));
    }
    req.client = client;
    res.setHeader("X-Request-Id", client.requestId);
    next();
  };
}
