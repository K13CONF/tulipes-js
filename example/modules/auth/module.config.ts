import type { Ctx } from "@tulipes/core/boot";

export default function authConfig({ Environment }: Ctx) {
  return {
    // Reads a secret owned by the sys core module — any module may read,
    // only one declares.
    jwtConfigured: Environment.store.has("JWT_SECRET"),
  };
}
