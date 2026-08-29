import type { Ctx } from "@tulipes/core/boot";
import { closeCache } from "../../lib/cache/index.js";

export default function coreConfig(_ctx: Ctx) {
  return {};
}

/** The sys core module owns app-wide infra glue lifecycles. */
export async function onShutdown(): Promise<void> {
  await closeCache();
}
