import type { Ctx } from "@tulipes/core/boot";

export default function usersConfig({ Environment }: Ctx) {
  // Types flow from the generated config.d.ts — no annotations needed.
  return {
    maxSessions: Environment.get("USERS_MAX_SESSIONS"),
    signupMode: Environment.get("USERS_SIGNUP_MODE"),
    adminEmail: Environment.get("USERS_ADMIN_EMAIL"),
  };
}

export async function onReady({ config }: Ctx): Promise<void> {
  console.log(`[users] ready — signup mode: ${config.users?.signupMode}`);
}

export async function onShutdown(): Promise<void> {
  console.log("[users] shutdown hook ran");
}
