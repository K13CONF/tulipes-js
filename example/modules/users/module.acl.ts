import type { AclBuilder } from "@tulipes/core/acl";

export default function usersAcl(acl: AclBuilder): void {
  acl.allow("user", "users:web:list", "users:web:ping");
  // The demo endpoints are open so the error-handling examples stay
  // curl-able without a token.
  acl.allow("guest", "users:web:demo:*", "users:web:ping");
  // The back office — users:bo:create, :delete, :list:deleted — stays with
  // admin and sysadmin, whose users:* grant in the auth module covers it.
}
