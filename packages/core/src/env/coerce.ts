import type { VariableSpec, VariableValue } from "./spec.js";

/**
 * Turn a raw value (a string from the shell / .env file, or a typed JSON
 * default) into the type its spec declares — or explain why it can't be.
 *
 * Env sources only ever give us strings, while JSON defaults arrive already
 * typed; both funnel through here so a bad *default* is caught with the same
 * rigor as a bad deployment value.
 */

export type CoerceResult =
  | { ok: true; value: VariableValue }
  | { ok: false; reason: string };

const TRUTHY = new Set(["true", "1", "yes", "on"]);
const FALSY = new Set(["false", "0", "no", "off"]);

export function coerceValue(spec: VariableSpec, raw: VariableValue): CoerceResult {
  switch (spec.type) {
    case "string":
    case "secret":
      return typeof raw === "string"
        ? { ok: true, value: raw }
        : { ok: false, reason: `expected a string, got ${typeof raw}` };

    case "number": {
      if (typeof raw === "number") return { ok: true, value: raw };
      const parsed = Number(raw);
      return Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: `"${String(raw)}" is not a number` };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const normalized = String(raw).trim().toLowerCase();
      if (TRUTHY.has(normalized)) return { ok: true, value: true };
      if (FALSY.has(normalized)) return { ok: true, value: false };
      return {
        ok: false,
        reason: `"${String(raw)}" is not a boolean (use true/false, 1/0, yes/no, on/off)`,
      };
    }

    case "enum": {
      const value = String(raw);
      // spec.enum presence is guaranteed by schema validation upstream.
      return spec.enum!.includes(value)
        ? { ok: true, value }
        : {
            ok: false,
            reason: `"${value}" is not one of: ${spec.enum!.join(", ")}`,
          };
    }

    case "url": {
      const value = String(raw);
      try {
        new URL(value);
        return { ok: true, value };
      } catch {
        // A replica set is addressed by a comma-separated host list —
        // `mongodb://a:27017,b:27017/db?replicaSet=rs0` — which is what every
        // self-hosted MongoDB deployment uses and which WHATWG URL parsing
        // rejects outright. Accept that one shape by checking a single host
        // from the list, so the type still catches a typo'd scheme or an
        // empty authority instead of waving the whole string through.
        const multiHost = /^([a-z][a-z0-9+.-]*:\/\/)(?:([^@/?#]*)@)?([^/?#]*,[^/?#]*)([/?#].*)?$/i.exec(value);
        if (multiHost) {
          const [, scheme, userinfo, hosts = "", rest = ""] = multiHost;
          const list = hosts.split(",");
          const credentials = userinfo ? `${userinfo}@` : "";
          if (list.every((host) => host.length > 0 && tryUrl(`${scheme}${credentials}${host}${rest}`))) {
            return { ok: true, value };
          }
        }
        return { ok: false, reason: `"${value}" is not a valid URL` };
      }
    }
  }
}

/** Does this parse as a URL at all? Used to validate one host of a list. */
function tryUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
