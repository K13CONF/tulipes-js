import type { Express } from "express";

import { BootReport } from "../errors/boot-error.js";
import { RAI_TAG, MOUNT_PATH, type RaiTag, type RouteRecord } from "./rai.js";

/**
 * Validate each endpoint's execution chain. Middleware remains trusted app
 * code and may terminate a request; this scan only covers route handlers.
 * Mount prefixes must be recorded by RouteRegistry.mount, never reconstructed
 * from Express's compiled matchers.
 */
interface Handler {
  handle?: unknown;
  method?: string;
}

interface Layer {
  [MOUNT_PATH]?: string;
  route?: { path: unknown; stack: Handler[]; methods?: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const PATH = /^\/(?:[a-zA-Z0-9_./~%-]|:[a-zA-Z_]\w*)*$/;
const tagOf = (entry: Handler | undefined): RaiTag | undefined =>
  (entry?.handle as Record<symbol, RaiTag> | undefined)?.[RAI_TAG];

export function scanRoutes(app: Express, report: BootReport): RouteRecord[] {
  const records: RouteRecord[] = [];
  const seen = new Map<string, RouteRecord>();

  for (const { layer, prefix } of walk(app, report)) {
    const route = layer.route!;
    const methods = Object.keys(route.methods ?? {});
    if (typeof route.path !== "string" || !PATH.test(route.path)) {
      report.add({ scope: "routes", message: `unsupported route path ${String(route.path)} — use a literal path with named :parameters` });
      continue;
    }
    const path = prefix + route.path;
    if (methods.some(method => !METHODS.has(method))) {
      report.add({ scope: "routes", message: `${path}: route.all() or unsupported HTTP method — declare each supported method with its own rai()` });
      continue;
    }
    for (const verb of methods) {
      const method = verb.toUpperCase();
      const stack = route.stack.filter(entry => !entry.method || entry.method === verb);
      const tags = stack.map(tagOf).filter((tag): tag is RaiTag => tag !== undefined);
      const tag = tags[0];
      if (!tag) {
        report.add({ scope: "routes", message: `${method} ${path} has no rai() declaration` });
        continue;
      }
      if (tagOf(stack[0]) !== tag || tags.length !== 1) {
        report.add({ scope: "routes", module: tag.module, message: `${method} ${path}: exactly one rai() must be the first handler` });
        continue;
      }
      if (tag.info.status !== undefined && (!Number.isInteger(tag.info.status) || tag.info.status < 200 || tag.info.status > 299)) {
        report.add({ scope: "routes", module: tag.module, message: `${method} ${path}: success status must be an integer 2xx code` });
        continue;
      }
      const record: RouteRecord = { ...tag, method, path };
      const clash = seen.get(tag.info.id);
      if (clash) {
        report.add({ scope: "routes", module: tag.module,
          message: `rai id "${tag.info.id}" is already declared by ${clash.method} ${clash.path} (${clash.module})` });
        continue;
      }
      seen.set(tag.info.id, record);
      records.push(record);
    }
  }
  return records;
}

/** Walk routers with explicit prefixes; detect recursive mounts instead of looping. */
function* walk(app: Express, report: BootReport): Generator<{ layer: Layer; prefix: string }> {
  const root = (app.router as { stack?: Layer[] }).stack;
  const queue: { layers: Layer[]; prefix: string; ancestors: Set<Layer[]> }[] = root
    ? [{ layers: root, prefix: "", ancestors: new Set([root]) }] : [];
  while (queue.length) {
    const { layers, prefix, ancestors } = queue.shift()!;
    for (const layer of layers) {
      if (layer.route) {
        yield { layer, prefix };
      } else if (layer.handle?.stack) {
        if (layer[MOUNT_PATH] === undefined) {
          report.add({ scope: "routes", message: "router mount path is unknown — use ctx.routes.mount(parent, path, router)" });
          continue;
        }
        const nested = layer.handle.stack;
        if (ancestors.has(nested)) {
          report.add({ scope: "routes", message: "recursive router mount is unsupported" });
          continue;
        }
        queue.push({ layers: nested, prefix: prefix + layer[MOUNT_PATH], ancestors: new Set([...ancestors, nested]) });
      }
    }
  }
}
