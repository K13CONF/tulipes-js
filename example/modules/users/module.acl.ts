import type { AclBuilder } from "@tulipes/core/acl";

export default function usersAcl(acl: AclBuilder): void {
  acl.allow("user", "users:read");
  // writes stay with admin, which already holds "*"
}
