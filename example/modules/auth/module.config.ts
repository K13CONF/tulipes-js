import type { Ctx } from "@tulipes/core/boot";

export default function authConfig({ Environment }: Ctx) {
  return {
    accessTtl: Environment.get("JWT_ACCESS_TTL"),
    refreshTtl: Environment.get("JWT_REFRESH_TTL"),
  };
}
