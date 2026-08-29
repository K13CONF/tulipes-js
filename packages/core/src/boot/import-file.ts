import { pathToFileURL } from "node:url";

import { BootReport, type BootScope } from "../errors/boot-error.js";

/**
 * Dynamic-import one conventional module file, funneling failures into the
 * boot report instead of letting a single broken file produce a bare stack
 * trace. Returns undefined on failure so callers can keep collecting.
 */
export async function importFile<T extends object = Record<string, unknown>>(
  filePath: string,
  scope: BootScope,
  moduleName: string,
  report: BootReport,
): Promise<T | undefined> {
  try {
    // pathToFileURL: plain absolute paths are not valid ESM specifiers on
    // every platform (Windows drive letters parse as URL schemes).
    return (await import(pathToFileURL(filePath).href)) as T;
  } catch (error) {
    report.add({
      scope,
      module: moduleName,
      message: `failed to import ${filePath}: ${(error as Error).message}`,
    });
    return undefined;
  }
}
