import type { RuntimeCtx } from "../boot/contracts.js";
import { importFile } from "../boot/import-file.js";
import type { BootReport } from "../errors/boot-error.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { agentDeclarationProblems, isAgentDeclaration, type AgentDeclaration } from "./define-agent.js";
import { AgentRegistry } from "./registry.js";

/**
 * Backend branch and inspection, after the route scan: import every
 * `agent/*.agent.ts` (at most one per module — the folder is a
 * declaration, not a collection of handlers) and build `ctx.agent`.
 */
export async function loadAgents(
  explored: readonly ModuleFiles[],
  ctx: RuntimeCtx,
  report: BootReport,
): Promise<AgentRegistry> {
  const declarations = new Map<string, AgentDeclaration>();

  for (const { module, agentFiles } of explored) {
    if (agentFiles.length > 1) {
      report.add({ scope: "agent", module: module.name, message: `one agent/*.agent file per module — found ${agentFiles.length}` });
      continue;
    }
    for (const file of agentFiles) {
      const exported = await importFile<{ default?: unknown }>(file, "agent", module.name, report);
      if (!exported) continue;
      if (!isAgentDeclaration(exported.default)) {
        report.add({ scope: "agent", module: module.name, message: `${file} must default-export defineAgent({ … })` });
        continue;
      }
      const problems = agentDeclarationProblems(exported.default);
      for (const problem of problems) report.add({ scope: "agent", module: module.name, message: `${file}: ${problem}` });
      if (problems.length === 0) declarations.set(module.name, exported.default);
    }
  }

  const registry = new AgentRegistry();
  registry.build_(ctx, ctx.modules, declarations, report);
  return registry;
}
