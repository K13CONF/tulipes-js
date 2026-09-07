import type { ConfigCtx, Ctx } from "@tulipes/core/boot";

/**
 * Runs in boot phase 6. Whatever this returns is stored at
 * `config.hello` and typed by `tulipes sync`, so every other module
 * reads it without importing anything from here.
 */
export default function helloConfig({ Environment }: ConfigCtx) {
  return {
    greeting: Environment.get("HELLO_GREETING"),
  };
}

/** After the process is fully up (server listening / worker consuming). */
export async function onReady({ config }: Ctx): Promise<void> {
  console.log(`[hello] ready — greeting with "${config.hello?.greeting}"`);
}

/**
 * Graceful shutdown. Hooks run in REVERSE load order, so a module can
 * rely on its dependencies still being alive while it cleans up.
 */
export async function onShutdown(): Promise<void> {
  // Close anything this module owns: timers, external clients, streams.
}
