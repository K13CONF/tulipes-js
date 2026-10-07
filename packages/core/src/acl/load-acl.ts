import { BootReport } from "../errors/boot-error.ts";
import { importFile } from "../boot/import-file.ts";
import type { ModuleFiles } from "../modules/explorer.ts";
import { Acl, type AclBuilder } from "./acl.ts";

/** Default export of `module.acl.ts`. */
export type AclFn = (acl: AclBuilder) => void | Promise<void>;

/**
 * Boot phase 7: run every `module.acl.ts` in load order against the shared
 * registry. Load order is what makes "define roles in the sys core module,
 * grant everywhere else" work without further ceremony: sys runs first.
 */
export async function loadAcl(
  explored: readonly ModuleFiles[],
  report: BootReport,
): Promise<Acl> {
  const acl = new Acl();

  for (const { module, aclFile } of explored) {
    if (!aclFile) continue;

    const exported = await importFile<{ default?: unknown }>(
      aclFile, "acl", module.name, report,
    );
    if (!exported) continue;

    if (typeof exported.default !== "function") {
      report.add({
        scope: "acl",
        module: module.name,
        message: "module.acl must default-export a function (acl) => void",
      });
      continue;
    }

    try {
      await (exported.default as AclFn)(acl.forModule(module.name, report));
    } catch (error) {
      report.add({
        scope: "acl",
        module: module.name,
        message: `acl function threw: ${(error as Error).message}`,
      });
    }
  }

  return acl;
}
