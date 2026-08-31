import type { Ctx } from "@tulipes/core/boot";

import { moduleLogger } from "@app/core";

export default function usersConfig({ Environment }: Ctx) {
  // Types flow from the generated config.d.ts — no annotations needed.
  return {
    maxSessions: Environment.get("USERS_MAX_SESSIONS"),
    signupMode: Environment.get("USERS_SIGNUP_MODE"),
    adminEmail: Environment.get("USERS_ADMIN_EMAIL"),
  };
}

export async function onReady({ config, Environment, mode }: Ctx): Promise<void> {
  // A child logger tagged with this module: "[users] …" on the console,
  // and a queryable "module":"users" field in the log files.
  moduleLogger(Environment, "users", mode).info(
    { signupMode: config.users?.signupMode },
    "module ready",
  );
}

export async function onShutdown(): Promise<void> {
  console.log("[users] shutdown hook ran");
}
