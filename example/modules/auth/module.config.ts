import type { Ctx } from "@forgex/core/boot";

export default function authConfig({ Environment }: Ctx) {
  return {
    // Reads a secret owned by the sys core module — any module may read,
    // only one declares.
    jwtConfigured: Environment.store.has("JWT_SECRET"),
  };
}
