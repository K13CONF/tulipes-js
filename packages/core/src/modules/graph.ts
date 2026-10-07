import { BootReport } from "../errors/boot-error.ts";
import type { ModuleManifest } from "./manifest.ts";

/**
 * Compute the definitive load order. Three sort keys, applied in order:
 *
 *   1. tier      — "sys" before "app"
 *   2. priority  — lower first, tie-breaker within a tier
 *   3. dependsOn — topological sort within the resulting order
 *
 * The topo sort is Kahn's algorithm, but ready modules are always picked in
 * (tier, priority, name) order — that keeps the output deterministic AND
 * guarantees the tier grouping holds: since a sys module may never depend on
 * an app module, every sys module drains from the ready set before the first
 * app module is picked.
 */
export function sortModules(
  modules: readonly ModuleManifest[],
  report: BootReport,
): ModuleManifest[] {
  const byName = new Map(modules.map((m) => [m.name, m]));

  let valid = true;
  for (const module of modules) {
    for (const dep of module.dependsOn) {
      const target = byName.get(dep);
      if (!target) {
        report.add({
          scope: "modules",
          module: module.name,
          message: `dependsOn "${dep}" — no such module exists`,
        });
        valid = false;
      } else if (module.tier === "sys" && target.tier === "app") {
        report.add({
          scope: "modules",
          module: module.name,
          message: `sys module cannot depend on app module "${dep}" — sys loads first by definition`,
        });
        valid = false;
      }
    }
  }
  // Broken edges make any order meaningless; skip the sort, the report
  // already carries the reason boot will abort.
  if (!valid) return [];

  const presorted = [...modules].sort(
    (a, b) =>
      Number(a.tier === "app") - Number(b.tier === "app") ||
      a.priority - b.priority ||
      a.name.localeCompare(b.name),
  );

  const blockers = new Map(
    modules.map((m) => [m.name, new Set(m.dependsOn)]),
  );

  const order: ModuleManifest[] = [];
  const placed = new Set<string>();
  while (order.length < modules.length) {
    const next = presorted.find(
      (m) => !placed.has(m.name) && blockers.get(m.name)!.size === 0,
    );
    if (!next) {
      report.add({
        scope: "modules",
        message: `dependency cycle: ${describeCycle(modules, blockers)}`,
      });
      return [];
    }
    order.push(next);
    placed.add(next.name);
    for (const remaining of blockers.values()) remaining.delete(next.name);
  }

  return order;
}

/**
 * When Kahn stalls, every unplaced module still has a blocker — walking
 * first-blockers from any of them must eventually revisit a node. That loop
 * is the cycle we print (e.g. "auth → users → auth").
 */
function describeCycle(
  modules: readonly ModuleManifest[],
  blockers: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const start = modules.find((m) => blockers.get(m.name)!.size > 0)!.name;

  const path: string[] = [];
  let current = start;
  while (!path.includes(current)) {
    path.push(current);
    current = blockers.get(current)!.values().next().value!;
  }
  return [...path.slice(path.indexOf(current)), current].join(" → ");
}
