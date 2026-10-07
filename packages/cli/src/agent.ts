import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { inspectApp } from "./inspection.js";

/**
 * `tulipes agent manifest` — every tool the app exposes to agents, from
 * the same inspection boot as `tulipes routes`: route tools from the RAIs
 * with method, path and input schema, actions from `agent/*.agent.ts`.
 * No service, secret or `.env` is needed. `--role` narrows it to what one
 * role may call, which is what the HTTP transport serves that role.
 */
export interface AgentManifestOptions {
  out?: string;
  role?: string;
}

export async function runAgentManifest(rootDir: string, options: AgentManifestOptions): Promise<void> {
  const handle = await inspectApp(rootDir);

  try {
    const registry = handle.ctx.agent!;
    const manifest = registry.manifest(options.role);
    const json = `${JSON.stringify(manifest, null, 2)}\n`;

    if (options.out) {
      const path = resolve(options.out);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, json);
      console.log(`wrote ${options.out}: ${manifest.tools.length} tool(s) across ${manifest.modules.length} module(s)`);
    } else {
      process.stdout.write(json);
    }

    if (registry.warnings.length > 0) {
      console.error(`\n${registry.warnings.length} schema(s) could not be described:`);
      for (const warning of registry.warnings) console.error(`  ! ${warning}`);
    }
  } finally {
    await handle.shutdown();
  }
}
