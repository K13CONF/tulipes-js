import type { AclBuilder } from "@tulipes/core/acl";

export default function usersAcl(acl: AclBuilder): void {
  acl.allow("user", "users:read", "users:ping");
  // The demo endpoints are open so the error-handling examples stay
  // curl-able without a token.
  acl.allow("guest", "users:demo-missing", "users:demo-boom", "users:ping");
  // Everything else — create, delete, read-deleted — stays with admin,
  // which already holds "*".
}
