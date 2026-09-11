import type { ConfigCtx, Ctx } from "@tulipes/core/boot";
import { configuredLogStreams } from "./helpers/log-stream.js";

export default function settingsConfig({ config }: ConfigCtx): Record<string, unknown> {
  return { ...config.settings };
}

/** End SSE while HTTP drains; shared auth/database resources are still available. */
export function onDrain({ Environment }: Ctx): void {
  configuredLogStreams(Environment).drain();
}
