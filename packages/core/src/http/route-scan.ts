import type { Express } from "express";

import { BootReport } from "../errors/boot-error.js";
import { RAI_TAG, type RaiTag, type RouteRecord } from "./rai.js";

/**
 * Walks the mounted Express stack and proves every endpoint declared a RAI.
 *
 * This is the enforcement half of the mechanism. Without it `rai()` would
 * be a convention, and a convention is exactly what gets forgotten — the
 * request pipeline authenticates rather than rejects, so an undeclared
 * route is not merely undocumented, it is unguarded. Finding that at boot
 * turns a silent hole into a failed deploy.
 *
 * Only *route* layers are checked. Middleware — helmet, cors, the logger,
 * the 404 handler — serves no endpoint of its own and declares nothing.
 */

interface Layer {
  name?: string;
  route?: { path: unknown; stack: { handle?: unknown }[]; methods?: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

export function scanRoutes(app: Express, report: BootReport): RouteRecord[] {
  const records: RouteRecord[] = [];
  const seen = new Map<string, RouteRecord>();

  for (const { layer, prefix } of walk(app)) {
    const route = layer.route!;
    const method = Object.keys(route.methods ?? {})
      .filter((m) => m !== "_all")
      .map((m) => m.toUpperCase())
      .join("|") || "ALL";
    const path = `${prefix}${String(route.path)}`;

    const tag = route.stack
      .map((entry) => (entry.handle as Record<symbol, RaiTag> | undefined)?.[RAI_TAG])
      .find((candidate): candidate is RaiTag => candidate !== undefined);

    if (!tag) {
      report.add({
        scope: "routes",
        message: `${method} ${path} has no rai() declaration — every route must declare one, or it is reachable by anyone`,
      });
      continue;
    }

    const record: RouteRecord = { ...tag, method, path };

    // A RAI names one access. Two routes claiming the same id would make
    // the registry — and anything generated from it — ambiguous.
    const clash = seen.get(tag.info.id);
    if (clash) {
      report.add({
        scope: "routes",
        module: tag.module,
        message: `rai id "${tag.info.id}" is already declared by ${clash.method} ${clash.path} (${clash.module})`,
      });
      continue;
    }

    seen.set(tag.info.id, record);
    records.push(record);
  }

  return records;
}

/** Depth-first over routers, carrying the mount prefix where readable. */
function* walk(app: Express): Generator<{ layer: Layer; prefix: string }> {
  // Express 5 exposes `router`; older shapes kept it on `_router`.
  const root = ((app as unknown as { router?: { stack?: Layer[] }; _router?: { stack?: Layer[] } })
    .router ?? (app as unknown as { _router?: { stack?: Layer[] } })._router)?.stack;

  const queue: { layers: Layer[]; prefix: string }[] = root ? [{ layers: root, prefix: "" }] : [];

  while (queue.length) {
    const { layers, prefix } = queue.shift()!;
    for (const layer of layers) {
      if (layer.route) {
        yield { layer, prefix };
      } else if (layer.handle?.stack) {
        // A nested router. Its mount path lives in a compiled regexp that
        // is not reliably readable across express versions, so paths are
        // reported relative to it rather than guessed at.
        queue.push({ layers: layer.handle.stack, prefix });
      }
    }
  }
}
